export async function sendTelegramMessage(text: string) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
        console.warn('Telegram Bot Token or Chat ID is missing. Signal ignored.');
        return false;
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Failed to send Telegram message:', errorText);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error sending Telegram message:', error);
        return false;
    }
}
