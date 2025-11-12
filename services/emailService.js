const nodemailer = require('nodemailer');

const HOST = process.env.EMAIL_HOST || process.env.SMTP_HOST;
const PORT = Number(process.env.EMAIL_PORT || process.env.SMTP_PORT || 587);
const SECURE = String(process.env.EMAIL_SECURE || 'false').toLowerCase() === 'true' || PORT === 465;
const USER = process.env.EMAIL_USER || process.env.SMTP_USER;
const PASS = process.env.EMAIL_PASS || process.env.SMTP_PASS;
const FROM = process.env.EMAIL_FROM || process.env.FROM_EMAIL || USER;
const ADMIN = process.env.ADMIN_EMAIL;

const transporter = nodemailer.createTransport({
  host: HOST,
  port: PORT,
  secure: SECURE,
  auth: USER ? { user: USER, pass: PASS } : undefined,
  tls: { rejectUnauthorized: false }
});

(async () => {
  try {
    await transporter.verify();
    console.log('✅ SMTP configurado:', HOST, PORT);
  } catch (e) {
    console.error('❌ SMTP falhou:', e?.message);
  }
})();

function formatCurrency(v) {
  return 'R$ ' + Number(v || 0).toFixed(2);
}

function buildCustomerHtml(order) {
  const itensHtml = (order.items || [])
    .map(
      (i) => `
    <tr>
      <td>${i.title}</td>
      <td>${i.quantity}</td>
      <td>${formatCurrency(i.unit_price)}</td>
      <td>${formatCurrency(i.unit_price * i.quantity)}</td>
    </tr>`
    )
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4CAF50;">✅ Pedido Confirmado!</h2>
      <p>Olá! Seu pedido foi aprovado com sucesso.</p>
      <p><strong>Número do Pedido:</strong> ${order.id}</p>
      
      <h3>📦 Itens do Pedido:</h3>
      <table style="width: 100%; border-collapse: collapse;" cellpadding="8" border="1">
        <thead>
          <tr style="background: #f5f5f5;">
            <th>Produto</th>
            <th>Qtd</th>
            <th>Valor Unit.</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>${itensHtml}</tbody>
      </table>
      
      <p style="font-size: 18px; margin-top: 20px;">
        <strong>Total: ${formatCurrency(order.total)}</strong>
      </p>
      
      ${order.cupom ? `<p>🎟️ <strong>Cupom aplicado:</strong> ${order.cupom}</p>` : ''}
      
      <h3>📍 Endereço de Entrega:</h3>
      <p>
        ${order.address?.rua || ''}, ${order.address?.numero || ''}<br>
        ${order.address?.cidade || ''} - ${order.address?.estado || ''}<br>
        CEP: ${order.address?.cep || ''}
      </p>
      
      <p style="margin-top: 30px; color: #666;">
        Qualquer dúvida, responda este e-mail.<br>
        Obrigado por comprar com a gente! 🛍️
      </p>
    </div>
  `;
}

function buildAdminHtml(order, user) {
  const itensHtml = (order.items || [])
    .map(
      (i) => `<li>${i.title} x ${i.quantity} - ${formatCurrency(i.unit_price * i.quantity)}</li>`
    )
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2196F3;">🎉 Nova Venda!</h2>
      <p><strong>Pedido:</strong> ${order.id}</p>
      <p><strong>Cliente:</strong> ${user?.name || user?.email || 'Não informado'}</p>
      <p><strong>Total:</strong> ${formatCurrency(order.total)}</p>
      
      <h3>📦 Itens:</h3>
      <ul>${itensHtml}</ul>
      
      ${order.cupom ? `<p>🎟️ <strong>Cupom usado:</strong> ${order.cupom}</p>` : ''}
      
      <h3>📍 Endereço de Entrega:</h3>
      <p>
        <strong>Nome:</strong> ${order.address?.nome || order.address?.name || user?.name || '—'}<br>
        ${order.address?.rua || ''}, ${order.address?.numero || ''}<br>
        ${order.address?.cidade || ''} - ${order.address?.estado || ''}<br>
        CEP: ${order.address?.cep || ''}<br>
        Telefone: ${order.address?.telefone || order.address?.phone || ''}
      </p>
    </div>
  `;
}

async function sendMail({ to, subject, html }) {
  if (!HOST) {
    console.warn('⚠️ SMTP não configurado');
    return;
  }
  // Evita erro "No recipients defined"
  if (!to || !/.+@.+\..+/.test(String(to))) {
    console.warn('⚠️ E-mail do destinatário inválido:', to);
    return;
  }
  console.log('📧 Enviando e-mail para:', to);
  return transporter.sendMail({ from: FROM, to, subject, html });
}

async function sendOrderEmails(order, user) {
  try {
    const jobs = [];

    if (user?.email) {
      jobs.push(
        sendMail({
          to: user.email,
          subject: `Pedido #${order.id} - Confirmação de Compra`,
          html: buildCustomerHtml(order),
        })
      );
    } else {
      console.warn('⚠️ E-mail do cliente não disponível');
    }

    if (ADMIN) {
      jobs.push(
        sendMail({
          to: ADMIN,
          subject: `🛒 Nova Venda #${order.id}`,
          html: buildAdminHtml(order, user),
        })
      );
    } else {
      console.warn('⚠️ ADMIN_EMAIL não configurado');
    }

    await Promise.all(jobs);
    console.log('✅ E-mails enviados com sucesso!');
  } catch (e) {
    console.error('❌ Erro ao enviar e-mails:', e.message);
  }
}

module.exports = { sendOrderEmails };