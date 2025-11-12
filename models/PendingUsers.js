const mongoose = require('mongoose');

const PendingUserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  image: { type: String, default: 'https://i.pravatar.cc/150?u=default' },
  code: { type: String, required: true },
  status: { type: String, required: true, default: 'UNVERIFIED' }
});

module.exports = mongoose.model('PendingUser', PendingUserSchema);
