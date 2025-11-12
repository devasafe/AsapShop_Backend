const router = require('express').Router();
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const Product = require('../models/Product');
const fetchUser = require('../middlewares/fetchUsers');

if (!process.env.MP_ACCESS_TOKEN) {
  console.warn('⚠️ MP_ACCESS_TOKEN não está definido no .env');
}

const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

// Endpoint original (Checkout Pro)
router.post('/pagar-pix', fetchUser, async (req, res) => {
  try {
    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({ success: false, error: 'MP_ACCESS_TOKEN não configurado no .env' });
    }

    const { itens = [], endereco } = req.body;
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ success: false, error: 'Itens do carrinho vazios' });
    }

    const itensMP = [];
    for (const item of itens) {
      const produto =
        (await Product.findOne({ id: item.id })) ||
        (await Product.findById(item.id).catch(() => null));

      if (!produto) continue;

      const qty = Number(item.quantity ?? item.qty ?? 1);
      const unitPrice = Number(produto.new_price);
      if (!qty || qty < 1) continue;
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;
      if (produto.stock != null && qty > produto.stock) continue;

      itensMP.push({
        title: produto.name,
        quantity: qty,
        unit_price: unitPrice,
        currency_id: 'BRL',
      });
    }

    if (itensMP.length === 0) {
      return res.status(400).json({ success: false, error: 'Nenhum item válido para criar a preferência' });
    }

    const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

    const preferenceClient = new Preference(mp);
    const pref = await preferenceClient.create({
      body: {
        items: itensMP,
        payer: { email: req.user?.email },
        payment_methods: {
          default_payment_method_id: 'pix',
          excluded_payment_types: [{ id: 'ticket' }],
          installments: 1,
        },
        back_urls: {
          success: `${FRONTEND_URL}/checkout/sucesso`,
          failure: `${FRONTEND_URL}/checkout/falha`,
          pending: `${FRONTEND_URL}/checkout/pendente`,
        },
        metadata: { userId: req.user?.id, endereco, itens },
      },
    });

    console.log('✅ Preferência criada:', pref.id);
    return res.json({ success: true, id: pref.id, init_point: pref.init_point });
  } catch (err) {
    console.error('❌ Erro ao gerar Pix:', err?.message, err);
    const status = Number(err?.status) || 500;
    return res.status(status).json({ success: false, error: err?.message || 'Falha ao criar preferência' });
  }
});

// ✅ Gera Pix DIRETO com suporte a CUPOM
router.post('/gerar-pix-direto', fetchUser, async (req, res) => {
  try {
    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({ success: false, error: 'MP_ACCESS_TOKEN não configurado' });
    }

    const { itens = [], endereco, valorTotal, cupom } = req.body; // ✅ Aceita valorTotal e cupom

    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ success: false, error: 'Itens vazios' });
    }

    let total = 0;
    const additionalItems = [];
    
    for (const item of itens) {
      const produto =
        (await Product.findOne({ id: item.id })) ||
        (await Product.findById(item.id).catch(() => null));
      
      if (!produto) continue;
      
      const qty = Number(item.quantity || item.qty || 1);
      const price = Number(produto.new_price);
      
      if (qty > 0 && price > 0) {
        total += qty * price;
        additionalItems.push({
          id: String(produto.id ?? produto._id),
          title: produto.name,
          quantity: qty,
          unit_price: price,
        });
      }
    }

    // ✅ USA valorTotal se foi enviado (com desconto de cupom)
    const finalAmount = valorTotal && valorTotal > 0 ? valorTotal : total;

    if (finalAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Total inválido' });
    }

    const paymentClient = new Payment(mp);
    const payment = await paymentClient.create({
      body: {
        transaction_amount: Number(finalAmount.toFixed(2)), // ✅ Usa o valor com desconto
        description: cupom 
          ? `Pedido ASAP Shop - Cupom: ${cupom}` 
          : 'Pedido ASAP Shop',
        payment_method_id: 'pix',
        payer: {
          email: req.user?.email || endereco?.email || 'cliente@email.com',
        },
        metadata: {
          userId: req.user?.id,
          endereco,
          itens,
          cupom: cupom || null, // ✅ Salva cupom nos metadados
          valorOriginal: total,
          valorFinal: finalAmount
        },
        additional_info: { items: additionalItems },
      },
    });

    console.log('✅ Pagamento Pix criado:', payment.id, cupom ? `com cupom ${cupom}` : '');
    
    return res.json({
      success: true,
      payment_id: payment.id,
      qr_code: payment.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: payment.point_of_interaction?.transaction_data?.qr_code_base64,
      ticket_url: payment.point_of_interaction?.transaction_data?.ticket_url,
      status: payment.status
    });
  } catch (err) {
    console.error('❌ Erro ao gerar Pix direto:', err?.message, err);
    return res.status(500).json({ 
      success: false, 
      error: err?.message || 'Erro ao gerar Pix' 
    });
  }
});

// ✅ Consultar status do pagamento
router.get('/status-payment/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const paymentClient = new Payment(mp);
    const payment = await paymentClient.get({ id: paymentId });

    res.json({
      success: true,
      status: payment.status,
      status_detail: payment.status_detail,
      payment: payment
    });
  } catch (error) {
    console.error('❌ Erro ao consultar status:', error.message);
    res.status(500).json({
      success: false,
      error: 'Erro ao consultar status'
    });
  }
});

module.exports = router;