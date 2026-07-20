require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // ou 'bcrypt', vamos usar bcryptjs por segurança
const Utilizador = require('./models/Utilizador');

async function fixAdminPassword() {
  try {
    console.log('A ligar à base de dados...');
    await mongoose.connect(process.env.MONGO_URI);
    
    const admin = await Utilizador.findOne({ email: 'admin@fisiocell.com' });
    
    if (!admin) {
      console.log('Admin não encontrado!');
      process.exit(1);
    }

    // Gerar a hash segura da password
    const salt = await bcrypt.genSalt(10);
    admin.password = await bcrypt.hash('password123', salt);
    
    await admin.save();
    console.log('✅ Password encriptada com sucesso! Já podes fazer login.');
    process.exit(0);
  } catch (error) {
    // Caso o pacote instalado se chame apenas 'bcrypt' em vez de 'bcryptjs'
    if (error.code === 'MODULE_NOT_FOUND') {
        console.log('Tentando com o pacote bcrypt normal...');
        const bcryptNormal = require('bcrypt');
        const admin = await Utilizador.findOne({ email: 'admin@fisiocell.com' });
        const salt = await bcryptNormal.genSalt(10);
        admin.password = await bcryptNormal.hash('password123', salt);
        await admin.save();
        console.log('✅ Password encriptada com sucesso (via bcrypt)! Já podes fazer login.');
        process.exit(0);
    } else {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
  }
}

fixAdminPassword();
