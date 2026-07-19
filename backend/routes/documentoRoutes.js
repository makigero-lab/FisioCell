/**
 * Rotas de Documentos — FisioCell
 *
 * Prefixo montado em server.js: /api/gestor/documentos
 *
 * F9 — Gestão de anexos clínicos (receitas, relatórios, fotografias).
 *
 * Permissões:
 *   - Listar/Obter/Download: podeVer (todos os 4 roles).
 *   - Upload: podeVer (todos podem carregar).
 *   - Eliminar: isDiretorClinico (só diretor/admin).
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { auth } = require('../middleware/auth');
const { isDiretorClinico } = require('../middleware/requireRole');
const {
  listarDocumentos,
  obterDocumento,
  downloadDocumento,
  uploadDocumento,
  eliminarDocumento,
} = require('../controllers/documentoController');

// Configuração do multer para storage local.
// Ficheiros vão para /uploads com nome único (timestamp + original).
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Nome único: timestamp + extensão original.
    const ext = path.extname(file.originalname);
    const nome = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, nome);
  },
});

// Filtro: aceita PDFs, imagens e documentos comuns.
const fileFilter = (req, file, cb) => {
  const tiposAceites = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ];
  if (tiposAceites.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipo de ficheiro não suportado: ${file.mimetype}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB máx.
  },
});

// Middleware: todos os 4 roles podem ver/carregar documentos.
const podeVer = (req, res, next) => {
  const role = req.user && req.user.role;
  if (!role) return res.status(401).json({ erro: 'Não autenticado.' });
  if (['admin', 'diretor_clinico', 'fisioterapeuta', 'rececionista'].includes(role)) {
    return next();
  }
  return res.status(403).json({ erro: 'Acesso negado.' });
};

// GET (listar/obter/download): podeVer (todos os 4 roles).
router.get('/', auth, podeVer, listarDocumentos);
router.get('/:id', auth, podeVer, obterDocumento);
router.get('/:id/download', auth, podeVer, downloadDocumento);

// Upload: podeVer (todos podem carregar).
router.post('/upload', auth, podeVer, upload.single('file'), uploadDocumento);

// Eliminar: isDiretorClinico (só admin + diretor_clinico).
router.delete('/:id', auth, isDiretorClinico, eliminarDocumento);

module.exports = router;
