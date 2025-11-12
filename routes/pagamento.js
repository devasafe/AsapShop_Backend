const router = require('express').Router();
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const Product = require('../models/Product');
const fetchUser = require('../middlewares/fetchUsers');
const Order = require('../models/Order');
const User = require('../models/Users');
const { sendOrderEmails } = require('../services/emailService');

if (!process.env.MP_ACCESS_TOKEN) {
  console.warn('⚠️ MP_ACCESS_TOKEN não está definido no .env');
}

const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

function sanitizeNotificationUrl(urlStr) {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    const isHttp = u.protocol === 'https:' || u.protocol === 'http:';
    const isLocal = ['localhost', '127.0.0.1'].includes(u.hostname);
    if (!isHttp || isLocal) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const RAW_BACKEND_URL = (process.env.BACKEND_PUBLIC_URL || '').replace(/\/$/, '');
const BACKEND_URL = RAW_BACKEND_URL;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const notificationUrl = sanitizeNotificationUrl(BACKEND_URL ? `${BACKEND_URL}/pagamento/mp/webhook` : '');

if (!notificationUrl) {
  console.warn('⚠️ notification_url NÃO será enviada (defina BACKEND_PUBLIC_URL pública, ex: https://<ngrok>.ngrok.io)');
}

/* =========================
   CRIAR PREFERÊNCIA (Checkout Pro)
   ========================= */
router.post('/criar-pagamento', fetchUser, async (req, res) => {
  try {
    const { itens, endereco, valor } = req.body;

    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ success: false, error: 'Itens inválidos' });
    }

    const itensMP = itens.map(item => ({
      title: item.title || 'Produto',
      quantity: Number(item.quantity || 1),
      unit_price: Number(item.unit_price) || 0,
      currency_id: 'BRL'
    }));

    const preferenceClient = new Preference(mp);
    const pref = await preferenceClient.create({
      body: {
        items: itensMP,
        payer: { email: req.user?.email },
        back_urls: {
          success: `${FRONTEND_URL}/pagamento/aguardando`,
          
          pending: `${FRONTEND_URL}/checkout/pendente`
        },
        ...(notificationUrl ? { notification_url: notificationUrl } : {}),
        metadata: {
          userId: req.user?.id,
          endereco: endereco || {},
          itens,
          valor
        }
      }
    });

    return res.json({ success: true, id: pref.id, init_point: pref.init_point });
  } catch (err) {
    console.error('❌ Erro ao criar pagamento:', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Erro ao criar pagamento' });
  }
});

/* =========================
   PAGAMENTO DIRETO COM CARTÃO
   ========================= */
router.post('/pagar-cartao-direto', fetchUser, async (req, res) => {
  try {
    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({ success: false, error: 'MP_ACCESS_TOKEN não configurado' });
    }

    const {
      token,
      payment_method_id: rawPmId,
      paymentMethodId,
      issuer_id: rawIssuerId,
      issuerId,
      installments = 1,
      payer = {},
      itens = [],
      endereco = {}
    } = req.body || {};

    const payment_method_id = rawPmId || paymentMethodId;
    const issuer_id = rawIssuerId || issuerId;

    console.log('💳 BACKEND RECEBIDO:', {
      hasToken: !!token,
      payment_method_id,
      issuer_id,
      installments,
      itensLen: Array.isArray(itens) ? itens.length : 0,
      payerIdentification: payer?.identification,
      payerEmailIncoming: payer?.email,
      enderecoEmail: endereco?.email,
      userEmail: req.user?.email
    });

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token do cartão ausente' });
    }
    if (!payment_method_id) {
      return res.status(400).json({ success: false, error: 'payment_method_id ausente' });
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ success: false, error: 'Itens vazios' });
    }

    // Calcula total
    let total = 0;
    for (const item of itens) {
      const produto =
        (await Product.findOne({ id: item.id })) ||
        (await Product.findById(item.id).catch(() => null));

      const qty = Number(item.quantity || item.qty || 1);
      const unitPrice = produto
        ? Number(produto.new_price || produto.price || item.unit_price || 0)
        : Number(item.unit_price || 0);

      if (qty > 0 && unitPrice > 0) total += qty * unitPrice;
    }
    if (total <= 0) {
      return res.status(400).json({ success: false, error: 'Total calculado inválido' });
    }

    const identification = payer?.identification?.number
      ? payer.identification
      : (endereco?.cpf
          ? { type: 'CPF', number: String(endereco.cpf).replace(/\D/g, '') }
          : undefined);

    const payerEmail = req.user?.email || payer?.email || endereco?.email;
    if (!payerEmail) {
      return res.status(400).json({ success: false, error: 'E-mail do pagador ausente' });
    }

    const paymentClient = new Payment(mp);
    const payment = await paymentClient.create({
      body: {
        transaction_amount: Number(total.toFixed(2)),
        token,
        description: 'Pedido ASAP Shop',
        installments: Number(installments) || 1,
        payment_method_id,
        issuer_id,
        payer: {
          email: payerEmail,
          identification
        },
        metadata: {
          userId: req.user?.id,
          endereco,
          itens
        },
        ...(notificationUrl ? { notification_url: notificationUrl } : {})
      }
    });

    console.log('✅ Pagamento cartão criado:', {
      id: payment.id,
      status: payment.status,
      detail: payment.status_detail,
      amount: payment.transaction_amount
    });

    return res.json({
      success: true,
      payment_id: payment.id,
      status: payment.status,
      status_detail: payment.status_detail
    });
  } catch (err) {
    console.error('❌ Erro pagar-cartao-direto:', err?.message);
    if (err?.status) console.error('MP status:', err.status);
    if (err?.cause) console.error('MP cause:', err.cause);
    if (err?.response?.data) console.error('MP response data:', err.response.data);
    const friendly =
      err?.cause?.[0]?.description ||
      err?.message ||
      'Erro interno';
    return res.status(500).json({ success: false, error: friendly });
  }
});

/* =========================
   PROCESSAR PEDIDO APÓS APROVAÇÃO
   ========================= */
router.post('/processar-pedido-imediato', fetchUser, async (req, res) => {
  try {
    const { payment_id, itens, endereco, cupom } = req.body;

    if (!payment_id) {
      return res.status(400).json({ success: false, error: 'payment_id obrigatório' });
    }

    const paymentClient = new Payment(mp);
    const payment = await paymentClient.get({ id: payment_id });

    if (payment.status !== 'approved') {
      return res.json({
        success: false,
        message: 'Pagamento ainda não aprovado',
        status: payment.status
      });
    }

    const exists = await Order.findOne({ paymentId: String(payment.id) });
    if (exists) {
      return res.json({ success: true, message: 'Pedido já processado', order_id: exists._id });
    }

    const paymentMethod =
      payment.payment_method_id === 'pix' ||
      payment.payment_type_id === 'bank_transfer'
        ? 'Pix'
        : payment.payment_method_id === 'credit_card'
        ? 'Cartão'
        : (payment.payment_type_id || payment.payment_method_id || '');

    const order = await Order.create({
      paymentId: String(payment.id),
      userId: req.user?.id,
      status: payment.status,
      paymentMethod,
      items: (itens || []).map(it => ({
        productId: String(it.id ?? it.productId ?? ''),
        title: it.title,
        unit_price: Number(it.unit_price || 0),
        quantity: Number(it.quantity || it.qty || 1),
        size: it.size,
        color: it.color
      })),
      amount: Number(payment.transaction_amount || 0),
      shipping: 0,
      total: Number(payment.transaction_amount || 0),
      address: endereco,
      phone: endereco?.telefone || endereco?.phone || '',
      payerEmail: payment.payer?.email || req.user?.email || '',
      raw: payment
    });

    // Atualiza estoque
    for (const it of order.items) {
      const qty = Number(it.quantity || 0);
      if (qty <= 0) continue;

      let updated = await Product.findOneAndUpdate(
        { id: Number(it.productId), stock: { $gte: qty } },
        { $inc: { stock: -qty } },
        { new: true }
      );

      if (!updated) {
        try {
          await Product.findOneAndUpdate(
            { _id: it.productId, stock: { $gte: qty } },
            { $inc: { stock: -qty } },
            { new: true }
          );
        } catch (e) {
          console.warn('Estoque não atualizado para item:', it.productId);
        }
      }
    }

    // Vincula pedido ao usuário
    if (req.user?.id) {
      try {
        await User.findByIdAndUpdate(
          req.user.id,
          {
            $push: {
              orders: order._id,
              historico: {
                paymentId: String(payment.id),
                itens: order.items.map(i => ({
                  id: i.productId,
                  qty: i.quantity,
                  name: i.title,
                  unit_price: i.unit_price,
                  size: i.size || 'Único',
                  color: i.color || 'Padrão'
                })),
                endereco,
                total: order.total,
                status: 'Aprovado',
                data: new Date(),
                paymentMethod
              }
            }
          },
          { new: true }
        );
      } catch (e) {
        console.warn('Erro ao vincular pedido:', e?.message);
      }
    }

    // E-mails
    try {
      let customerEmail = null;
      let customerName = null;

      if (req.user?.id) {
        try {
          const userFromDB = await User.findById(req.user.id).select('email name');
          if (userFromDB?.email) {
            customerEmail = userFromDB.email;
            customerName = userFromDB.name;
          }
        } catch {}
      }

      if (!customerEmail) {
        const payerEmail = payment.payer?.email;
        if (payerEmail && !payerEmail.includes('X') && payerEmail.includes('@')) {
          customerEmail = payerEmail;
        }
      }

      if (!customerEmail && endereco?.email) customerEmail = endereco.email;

      if (customerEmail) {
        const emailOrder = {
          id: order.paymentId,
          items: order.items.map(i => ({
            title: i.title,
            quantity: i.quantity,
            unit_price: i.unit_price
          })),
          total: order.total,
          address: order.address,
          cupom: cupom || payment?.metadata?.cupom || null,
          status: 'paid'
        };

        const userForEmail = {
          email: customerEmail,
          name: customerName || endereco?.nome
        };

        await sendOrderEmails(emailOrder, userForEmail);
      } else {
        console.warn('⚠️ Nenhum e-mail válido para envio');
      }
    } catch (e) {
      console.error('❌ Erro envio e-mail:', e);
    }

    return res.json({
      success: true,
      order_id: order._id,
      status: payment.status
    });
  } catch (err) {
    console.error('❌ Erro ao processar pedido:', err?.message);
    return res.status(500).json({ success: false, error: err?.message });
  }
});

/* =========================
   WEBHOOK
   ========================= */
router.post('/mp/webhook', async (req, res) => {
  try {
    const type = req.query.type || req.body.type;
    if (type === 'payment') {
      const paymentId = req.query['data.id'] || req.body?.data?.id;
      if (paymentId) {
        const paymentClient = new Payment(mp);
        const payment = await paymentClient.get({ id: paymentId });
        console.log('MP payment:', payment.id, payment.status);

        const exists = await Order.findOne({ paymentId: String(payment.id) });
        if (!exists && payment.status === 'approved') {
          const meta = payment.metadata || {};

          let itens = [];
          try {
            if (Array.isArray(meta.itens)) itens = meta.itens;
            else if (typeof meta.itens === 'string') itens = JSON.parse(meta.itens);
          } catch {}

          let endereco = {};
          try {
            if (meta.endereco) endereco = typeof meta.endereco === 'string' ? JSON.parse(meta.endereco) : meta.endereco;
          } catch {}

          const userId = meta.userId ? String(meta.userId) : null;

          const paymentMethod =
            payment.payment_method_id === 'pix' ||
            payment.payment_type_id === 'bank_transfer'
              ? 'Pix'
              : payment.payment_method_id === 'credit_card'
              ? 'Cartão'
              : (payment.payment_type_id || payment.payment_method_id || '');

          const order = await Order.create({
            paymentId: String(payment.id),
            userId,
            status: payment.status,
            paymentMethod,
            items: itens.map(it => ({
              productId: String(it.id ?? it.productId ?? ''),
              title: it.title,
              unit_price: Number(it.unit_price || 0),
              quantity: Number(it.quantity || it.qty || 1),
              size: it.size,
              color: it.color
            })),
            amount: Number(payment.transaction_amount || 0),
            shipping: 0,
            total: Number(payment.transaction_amount || 0),
            address: endereco,
            phone: endereco?.telefone || endereco?.phone || '',
            payerEmail: payment.payer?.email || '',
            raw: payment
          });

          // Atualiza estoque
          for (const it of order.items) {
            const qty = Number(it.quantity || 0);
            if (qty <= 0) continue;
            let updated = await Product.findOneAndUpdate(
              { id: Number(it.productId), stock: { $gte: qty } },
              { $inc: { stock: -qty } },
              { new: true }
            );
            if (!updated) {
              try {
                await Product.findOneAndUpdate(
                  { _id: it.productId, stock: { $gte: qty } },
                  { $inc: { stock: -qty } },
                  { new: true }
                );
              } catch (e) {
                console.warn('Estoque não atualizado para item:', it.productId);
              }
            }
          }

          // Vincula usuário e envia e-mails
          try {
            if (userId) {
              await User.findByIdAndUpdate(
                userId,
                {
                  $push: {
                    orders: order._id,
                    historico: {
                      paymentId: String(payment.id),
                      itens: order.items.map(i => ({
                        id: i.productId,
                        qty: i.quantity,
                        name: i.title,
                        unit_price: i.unit_price,
                        size: i.size || 'Único',
                        color: i.color || 'Padrão'
                      })),
                      endereco,
                      total: order.total,
                      status: 'Aprovado',
                      data: new Date(),
                      paymentMethod
                    }
                  }
                },
                { new: true }
              );
            }

            let customerEmail = null;
            let customerName = null;

            if (userId) {
              try {
                const u = await User.findById(userId).select('email name');
                if (u?.email) {
                  customerEmail = u.email;
                  customerName = u.name;
                }
              } catch {}
            }

            if (!customerEmail) {
              const payerEmail = payment.payer?.email;
              if (payerEmail && !payerEmail.includes('X') && payerEmail.includes('@')) {
                customerEmail = payerEmail;
              }
            }

            if (!customerEmail && endereco?.email) customerEmail = endereco.email;

            if (customerEmail) {
              const emailOrder = {
                id: order.paymentId,
                items: order.items.map(i => ({
                  title: i.title,
                  quantity: i.quantity,
                  unit_price: i.unit_price
                })),
                total: order.total,
                address: order.address,
                cupom: meta?.cupom || null,
                status: 'paid'
              };

              const userForEmail = {
                email: customerEmail,
                name: customerName || endereco?.nome
              };

              await sendOrderEmails(emailOrder, userForEmail);
            } else {
              console.warn('⚠️ [WEBHOOK] Nenhum e-mail válido encontrado');
            }
          } catch (e) {
            console.error('❌ [WEBHOOK] Erro ao enviar e-mails:', e);
          }
        }
      }
    }
    return res.sendStatus(200);
  } catch (err) {
    console.error('MP webhook erro:', err);
    return res.sendStatus(200);
  }
});

/* =========================
   STATUS DO PAGAMENTO
   ========================= */
router.get('/status-payment/:paymentId', async (req, res) => {
  try {
    const paymentClient = new Payment(mp);
    const payment = await paymentClient.get({ id: req.params.paymentId });

    return res.json({
      success: true,
      status: payment.status,
      status_detail: payment.status_detail
    });
  } catch (err) {
    console.error('❌ Erro ao buscar status do pagamento:', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Erro ao buscar status' });
  }
});

module.exports = router;