const router = require('express').Router();
const { MercadoPagoConfig, Payment } = require('mercadopago');
const Order = require('../models/Order');
const User = require('../models/Users');
const Product = require('../models/Product');

if (!process.env.MP_ACCESS_TOKEN) {
  console.warn('⚠️ MP_ACCESS_TOKEN não está definido no .env');
}
const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

// Normaliza itens vindos de metadata.itens (array/JSON) ou additional_info.items
function extractItems(payment) {
  const meta = payment.metadata || {};
  let itens = [];

  if (Array.isArray(meta.itens)) {
    itens = meta.itens;
  } else if (typeof meta.itens === 'string') {
    try { itens = JSON.parse(meta.itens); } catch {}
  } else if (Array.isArray(payment.additional_info?.items)) {
    itens = payment.additional_info.items.map(i => ({
      id: i.id,
      title: i.title,
      quantity: i.quantity,
      unit_price: i.unit_price,
    }));
  }

  return itens.map(it => ({
    productId: String(it.id ?? it.productId ?? ''),
    title: it.title,
    unit_price: Number(it.unit_price || 0),
    quantity: Number(it.quantity || it.qty || 1),
    size: it.size,
    color: it.color,
  })).filter(i => i.productId && i.quantity > 0);
}

// Baixa estoque com segurança (não deixa negativo)
async function decrementStock(items) {
  for (const it of items) {
    const qty = Number(it.quantity || 0);
    if (!qty) continue;

    // tenta pelo campo id numérico
    let updated = await Product.findOneAndUpdate(
      { id: Number(it.productId), stock: { $gte: qty } },
      { $inc: { stock: -qty } },
      { new: true }
    );

    if (!updated) {
      // fallback: tenta por _id
      try {
        updated = await Product.findOneAndUpdate(
          { _id: it.productId, stock: { $gte: qty } },
          { $inc: { stock: -qty } },
          { new: true }
        );
      } catch {}
    }

    if (!updated) {
      console.warn('Estoque insuficiente ou produto não encontrado para:', it.productId);
    }
  }
}

// Webhook Mercado Pago (use notification_url: <BACKEND>/pagamento/mp/webhook)
router.post('/pagamento/mp/webhook', async (req, res) => {
  const type = req.query.type || req.body?.type;
  const paymentId = req.query['data.id'] || req.body?.data?.id;
  if (type !== 'payment' || !paymentId) return res.sendStatus(200);

  try {
    const paymentClient = new Payment(mp);
    const payment = await paymentClient.get({ id: paymentId });

    if (payment.status !== 'approved') {
      return res.sendStatus(200);
    }

    // idempotência por paymentId
    const exists = await Order.findOne({ paymentId: String(payment.id) }).select('_id');
    if (exists) return res.sendStatus(200);

    const meta = payment.metadata || {};
    const userId = meta.userId ? String(meta.userId) : null;
    const address = (() => {
      try {
        if (!meta.endereco) return {};
        return typeof meta.endereco === 'string' ? JSON.parse(meta.endereco) : meta.endereco;
      } catch { return {}; }
    })();

    const items = extractItems(payment);
    const total = Number(payment.transaction_amount || 0);

    // cria Order
    const order = await Order.create({
      paymentId: String(payment.id),
      userId,
      status: payment.status,
      items,
      amount: total,
      shipping: 0,
      total,
      address,
      phone: address?.telefone || address?.phone || '',
      payerEmail: payment.payer?.email || '',
      raw: payment,
    });

    // baixa estoque
    await decrementStock(items);

    // vincula pedido ao usuário e salva histórico simples
    if (userId) {
      try {
        await User.findByIdAndUpdate(userId, {
          $push: { orders: order._id, historico: {
            paymentId: String(payment.id),
            itens: items.map(i => ({
              id: i.productId,
              qty: i.quantity,
              name: i.title,
              unit_price: i.unit_price,
              size: i.size || 'Único',
              color: i.color || 'Padrão',
            })),
            endereco: address,
            total,
            status: 'Aprovado',
            data: new Date(),
          } }
        });
      } catch (e) {
        console.warn('Não foi possível atualizar o usuário:', userId, e?.message);
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error('Erro no webhook MP:', err?.message || err);
    // sempre 200 para o MP não reenfileirar infinitamente
    return res.sendStatus(200);
  }
});

module.exports = router;