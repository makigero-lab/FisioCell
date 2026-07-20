require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Utilizador = require('./models/Utilizador');

async function testarLogin() {
  try {
    console.log('🔌 A ligar à base de dados...');
    await mongoose.connect(process.env.MONGO_URI);
    
    console.log('🔍 A procurar o admin...');
    const admin = await Utilizador.findOne({ email: 'admin@fisiocell.com' });
    
    if (!admin) {
      console.log('❌ O admin não existe na base de dados.');
      process.exit(1);
    }

    console.log(`✅ Admin encontrado! (Role: ${admin.role})`);
    
    // Testa se a password bate certo
    const isMatch = await bcrypt.compare('password123', admin.password);
    
    if (isMatch) {
      console.log('🟢 A PASSWORD ESTÁ CORRETA! O problema é na comunicação entre a Vercel e o Render.');
    } else {
      console.log('🔴 A PASSWORD ESTÁ ERRADA! Provavelmente sofreu um duplo-hash.');
      console.log('Hash atual na DB:', admin.password);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro no script:', error);
    process.exit(1);
  }
}

testarLogin();
