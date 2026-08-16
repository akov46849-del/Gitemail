const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// === Ограничение времени работы (6 часов) ===
const MAX_RUNTIME = 6 * 60 * 60 * 1000; // 6 часов в миллисекундах
const startTime = Date.now();

// === Инициализация Firebase Admin SDK ===
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://zing-4a547-default-rtdb.europe-west1.firebasedatabase.app/'
});
const db = admin.database();

// === Настройки SMTP (Brevo) ===
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
});

// === Генерация 6-значного кода ===
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// === Отправка письма ===
async function sendCodeEmail(toEmail, code) {
    const html = `
        <h1>Ваш код для входа в ZING</h1>
        <p>Введите этот код на странице входа:</p>
        <h2 style="background: #f0f0f0; padding: 20px; border-radius: 10px; font-size: 36px; text-align: center;">${code}</h2>
        <p>Код действителен 10 минут.</p>
        <p><strong>Если письмо не пришло, проверьте папку «Спам» или «Рассылки».</strong></p>
        <p>Если вы не запрашивали вход, проигнорируйте это письмо.</p>
        <br><p>С уважением, команда ZING</p>
    `;

    const mailOptions = {
        from: `"ZING" <${FROM_EMAIL}>`,
        to: toEmail,
        subject: 'Код для входа в ZING',
        html: html,
        text: `Ваш код для входа в ZING: ${code}. Код действителен 10 минут. Если письмо не пришло, проверьте папку «Спам» или «Рассылки».`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Письмо отправлено на ${toEmail}`);
        return true;
    } catch (error) {
        console.error(`❌ Ошибка отправки на ${toEmail}:`, error.message);
        return false;
    }
}

// === БЕСКОНЕЧНЫЙ ЦИКЛ ПРОВЕРКИ (каждые 10 секунд) ===
async function processQueue() {
    console.log('🚀 Запущен процесс обработки очереди (каждые 10 секунд)');
    console.log(`📧 Отправитель: ${FROM_EMAIL}`);
    console.log(`🔗 База данных: ${admin.app().options.databaseURL}`);
    console.log(`⏳ Максимальное время работы: 6 часов`);
    console.log('-----------------------------------');

    let totalSent = 0;

    while (true) {
        // Проверяем, не истекло ли время работы
        if (Date.now() - startTime > MAX_RUNTIME) {
            console.log('⏰ 6 часов прошло. Завершаем работу для перезапуска.');
            process.exit(0);
        }

        try {
            const ref = db.ref('emailQueue');
            const snapshot = await ref.once('value');
            const queue = snapshot.val();

            if (queue) {
                const entries = Object.entries(queue).filter(([key, value]) => value.status === 'pending');

                if (entries.length > 0) {
                    console.log(`📬 Найдено ${entries.length} запросов. Обработка...`);

                    for (const [key, request] of entries) {
                        const email = request.email;
                        if (!email) continue;

                        // Генерируем код
                        const code = generateCode();

                        // Сохраняем код в Firebase (для проверки на клиенте)
                        const codeRef = db.ref('codes').child(email.replace(/\./g, '_'));
                        await codeRef.set({
                            code: code,
                            createdAt: Date.now()
                        });

                        // Отправляем письмо
                        const success = await sendCodeEmail(email, code);

                        if (success) {
                            await ref.child(key).update({ status: 'sent' });
                            console.log(`✅ Обработан запрос для ${email}`);
                            totalSent++;
                        } else {
                            console.log(`⚠️ Ошибка отправки для ${email}, оставляем в очереди.`);
                        }
                    }
                }
            }

            // Ждём 10 секунд перед следующей проверкой
            await new Promise(resolve => setTimeout(resolve, 10000));
        } catch (error) {
            console.error('❌ Ошибка в цикле:', error.message);
            // Не прерываем цикл, продолжаем
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }
}

// === ЗАПУСК ===
processQueue().catch(error => {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
});
