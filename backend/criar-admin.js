require('dotenv').config();
const mongoose = require('mongoose');
const Utilizador = require('./models/Utilizador');
const Empresa = require('./models/Empresa');

async function criarAdmin() {
  try {
    console.log('A ligar à base de dados...');
    await mongoose.connect(process.env.MONGO_URI);
    
    // 1. Recuperar a Empresa que criámos há bocado
    const empresa = await Empresa.findOne({ email: 'geral@fisiocell.com' });
    
    // 2. Criar o Utilizador com a permissão correta
    const existe = await Utilizador.findOne({ email: 'admin@fisiocell.com' });
    if (existe) {
      console.log('O administrador já existe!');
      process.exit(0);
    }

    const admin = new Utilizador({
      nome: 'Administrador FisioCell',
      email: 'admin@fisiocell.com',
      password: 'password123', 
      role: 'admin', // O cargo exato exigido pelo modelo!
      empresa_id: empresa._id
    });

    await admin.save();
    console.log('✅ Admin criado com sucesso! Login: admin@fisiocell.com / password123');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro:', error);
    process.exit(1);
  }
}

criarAdmin();
