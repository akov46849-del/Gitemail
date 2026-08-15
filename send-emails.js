const nodemailer = require('nodemailer');
const axios = require('axios');

// Читаем секреты из переменных окружения (GitHub Secrets)
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

// ВАШ URL БАЗЫ ДАННЫХ FIREBASE (уже вставлен)
const FIREBASE_DATABASE_URL = 'https://zing-4a547-default-rtdb.europe-west1.firebasedatabase.app/';

// Создаём транспорт для отправки писем
const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASSWORD,
    },
});

// Генерация 6-значного кода
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Отправка одного письма
async function sendCodeEmail(toEmail, code) {
    const html = `
        <h1>Ваш код для входа в ZING</h1>
        <p>Введите этот код на странице входа:</p>
        <h2 style="background: #f0f0f0; padding: 20px; border-radius: 10px; font-size: 36px; text-align: center;">${code}</h2>
        <p>Код действителен 10 минут.</p>
        <p>Если вы не запрашивали вход, проигнорируйте это письмо.</p>
        <br><p>С уважением, команда ZING</p>
    `;

    const mailOptions = {
        from: `"ZING" <${FROM_EMAIL}>`,
        to: toEmail,
        subject: 'Код для входа в ZING',
        html: html,
        text: `Ваш код для входа в ZING: ${code}. Код действителен 10 минут.`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Письмо отправлено на ${toEmail}`);
        return true;
    } catch (error) {
        console.error(`❌ Ошибка отправки на ${toEmail}:`, error);
        return false;
    }
}

// Главная функция: читает очередь из Firebase и отправляет письма
async function processQueue() {
    console.log('🚀 Начинаем обработку очереди...');

    try {
        // Читаем все записи из /emailQueue
        const url = `${FIREBASE_DATABASE_URL}/emailQueue.json`;
        const response = await axios.get(url);
        const queue = response.data;

        if (!queue) {
            console.log('📭 Очередь пуста.');
            return;
        }

        // Фильтруем только те, у которых status = 'pending'
        const entries = Object.entries(queue).filter(([key, value]) => value.status === 'pending');

        if (entries.length === 0) {
            console.log('📭 Нет новых запросов.');
            return;
        }

        console.log(`📬 Найдено ${entries.length} запросов.`);

        for (const [key, request] of entries) {
            const email = request.email;
            if (!email) continue;

            // Генерируем код
            const code = generateCode();

            // Сохраняем код в Firebase (для проверки на клиенте)
            const codeRef = `${FIREBASE_DATABASE_URL}/codes/${email.replace(/\./g, '_')}.json`;
            await axios.put(codeRef, {
                code: code,
                createdAt: Date.now()
            });

            // Отправляем письмо
            const success = await sendCodeEmail(email, code);

            if (success) {
                // Помечаем запрос как обработанный
                const updateUrl = `${FIREBASE_DATABASE_URL}/emailQueue/${key}.json`;
                await axios.patch(updateUrl, { status: 'sent' });
                console.log(`✅ Обработан запрос для ${email}`);
            } else {
                console.log(`⚠️ Ошибка отправки для ${email}, оставляем в очереди.`);
            }
        }

        console.log('🏁 Обработка завершена.');
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
        process.exit(1);
    }
}

// Запуск
processQueue();
