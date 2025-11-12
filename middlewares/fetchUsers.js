const jwt = require('jsonwebtoken');


const fetchUser = async (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1] || req.header('auth-token');
  if (!token) return res.status(401).send({ errors: "Token ausente" });

  try {
    const data = jwt.verify(token, process.env.JWT_SECRET);
    req.user = data.user;
    next();
  } catch (err) {
    console.error('Erro JWT:', err);
    res.status(401).send({ errors: "Token inválido" });
  }
};
module.exports = fetchUser;