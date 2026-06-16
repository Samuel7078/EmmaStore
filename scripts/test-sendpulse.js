require('dotenv').config();

async function testSendPulse() {
    console.log("Testeando SendPulse...");
    if (!process.env.SENDPULSE_ID || !process.env.SENDPULSE_SECRET) {
        return console.error("Faltan credenciales de SendPulse en .env");
    }

    try {
        const tokenRes = await fetch('https://api.sendpulse.com/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'client_credentials',
                client_id: process.env.SENDPULSE_ID,
                client_secret: process.env.SENDPULSE_SECRET
            })
        });
        const tokenData = await tokenRes.json();
        
        if (tokenData.access_token) {
            console.log("Token obtenido exitosamente.");
            
            const htmlContent = "<h1>Hola prueba</h1>";
            const base64Html = Buffer.from(htmlContent).toString('base64');
            
            const emailPayload = {
                email: {
                    html: base64Html,
                    text: "Hola prueba txt",
                    subject: "Test SendPulse",
                    from: {
                        name: "Emma Store",
                        email: process.env.GMAIL_USER_2 || process.env.SENDPULSE_SENDER_EMAIL || 'pedidos@emmastore.com'
                    },
                    to: [{ name: "Test User", email: "test@emmastore.com" }]
                }
            };
            
            console.log("Enviando con From:", emailPayload.email.from.email);
            
            const sendRes = await fetch('https://api.sendpulse.com/smtp/emails', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenData.access_token}`
                },
                body: JSON.stringify(emailPayload)
            });
            
            const sendData = await sendRes.json();
            console.log('Sendpulse API result:', sendData);
        } else {
            console.error("Error obteniendo token:", tokenData);
        }
    } catch (err) {
        console.error("Error:", err);
    }
}

testSendPulse();
