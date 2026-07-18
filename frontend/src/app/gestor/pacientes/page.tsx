"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  UserRound,
  Loader2,
  AlertCircle,
  RefreshCw,
  Power,
  Pencil,
  Trash2,
  Search,
  Phone,
  Mail,
  Calendar,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  adminGet,
  adminPost,
  adminPut,
  adminPatch,
  adminDelete,
  type PacienteDTO,
  type PacienteListResponse,
} from "@/lib/api";

/**
 * Página de Pacientes — F2.
 *
 * CRUD completo de pacientes com permissões baseadas em role:
 *   - Todos os 4 roles podem ver (rececionista recebe versão sanitizada).
 *   - Todos podem criar/editar (fisio edita campos clínicos; rececionista edita admin).
 *   - Só diretor_clinico/admin podem eliminar (soft delete).
 *
 * O backend devolve `dados_clinicos: true/false` para o frontend saber se
 * pode mostrar os campos clínicos (historico, alergias, emergência).
 */
export default function PacientesPage() {
  const [pacientes, setPacientes] = useState<PacienteDTO[]>([]);
  const [dadosClinicos, setDadosClinicos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Busca
  const [busca, setBusca] = useState("");

  // Modal criar/editar
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState({
    nome: "",
    telefone: "",
    email: "",
    data_nascimento: "",
    genero: "NA" as "M" | "F" | "Outro" | "NA",
    num_utente: "",
    nif: "",
    morada: "",
    historico_medico: "",
    alergias: "",
    contacto_emergencia_nome: "",
    contacto_emergencia_telefone: "",
    contacto_emergencia_relacao: "",
    observacoes: "",
    consentimento: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formErro, setFormErro] = useState<string | null>(null);

  // Modal detalhe
  const [detalhe, setDetalhe] = useState<PacienteDTO | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const params = busca ? `?busca=${encodeURIComponent(busca)}` : "";
      const data = await adminGet<PacienteListResponse>(`/gestor/pacientes${params}`);
      setPacientes(data.pacientes || []);
      setDadosClinicos(!!data.dados_clinicos);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar pacientes.");
    } finally {
      setLoading(false);
    }
  }, [busca]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function abrirCriar() {
    setEditandoId(null);
    setForm({
      nome: "", telefone: "", email: "", data_nascimento: "", genero: "NA",
      num_utente: "", nif: "", morada: "",
      historico_medico: "", alergias: "",
      contacto_emergencia_nome: "", contacto_emergencia_telefone: "", contacto_emergencia_relacao: "",
      observacoes: "", consentimento: false,
    });
    setFormErro(null);
    setMostrarForm(true);
  }

  function abrirEditar(p: PacienteDTO) {
    setEditandoId(p._id);
    setForm({
      nome: p.nome || "",
      telefone: p.telefone || "",
      email: p.email || "",
      data_nascimento: p.data_nascimento ? p.data_nascimento.split("T")[0] : "",
      genero: p.genero || "NA",
      num_utente: p.num_utente || "",
      nif: p.nif || "",
      morada: p.morada || "",
      historico_medico: p.historico_medico || "",
      alergias: Array.isArray(p.alergias) ? p.alergias.join(", ") : "",
      contacto_emergencia_nome: p.contacto_emergencia?.nome || "",
      contacto_emergencia_telefone: p.contacto_emergencia?.telefone || "",
      contacto_emergencia_relacao: p.contacto_emergencia?.relacao || "",
      observacoes: p.observacoes || "",
      consentimento: p.consentimento_dados?.concedido || false,
    });
    setFormErro(null);
    setMostrarForm(true);
  }

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setFormErro(null);
    if (!form.nome.trim() || !form.telefone.trim()) {
      setFormErro("Nome e Telefone são obrigatórios.");
      return;
    }

    const body: Record<string, unknown> = {
      nome: form.nome.trim(),
      telefone: form.telefone.trim(),
      email: form.email.trim(),
      data_nascimento: form.data_nascimento || null,
      genero: form.genero,
      num_utente: form.num_utente.trim(),
      nif: form.nif.trim(),
      morada: form.morada.trim(),
      observacoes: form.observacoes.trim(),
      consentimento_dados: { concedido: form.consentimento, versao_termos: "1.0" },
    };

    // Campos clínicos — só envia se o utilizador tem acesso clínico.
    if (dadosClinicos) {
      body.historico_medico = form.historico_medico;
      body.alergias = form.alergias
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      if (form.contacto_emergencia_nome || form.contacto_emergencia_telefone) {
        body.contacto_emergencia = {
          nome: form.contacto_emergencia_nome.trim(),
          telefone: form.contacto_emergencia_telefone.trim(),
          relacao: form.contacto_emergencia_relacao.trim(),
        };
      }
    }

    setSubmitting(true);
    try {
      if (editandoId) {
        await adminPut(`/gestor/pacientes/${editandoId}`, body);
      } else {
        await adminPost(`/gestor/pacientes`, body);
      }
      setMostrarForm(false);
      await carregar();
    } catch (e: unknown) {
      setFormErro(e instanceof Error ? e.message : "Erro ao guardar paciente.");
    } finally {
      setSubmitting(false);
    }
  }

  async function alternarEstado(p: PacienteDTO) {
    try {
      await adminPatch(`/gestor/pacientes/${p._id}/estado`, { ativo: !p.ativo });
      await carregar();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao alterar estado.");
    }
  }

  async function eliminar(p: PacienteDTO) {
    if (!confirm(`Eliminar paciente "${p.nome}"? (Soft delete — preserva histórico)`)) return;
    try {
      await adminDelete(`/gestor/pacientes/${p._id}`);
      await carregar();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao eliminar paciente.");
    }
  }

  function calcularIdade(dn: string | null): string {
    if (!dn) return "—";
    const d = new Date(dn);
    if (isNaN(d.getTime())) return "—";
    const agora = new Date();
    let idade = agora.getFullYear() - d.getFullYear();
    const m = agora.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && agora.getDate() < d.getDate())) idade--;
    return `${idade} anos`;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <UserRound className="h-6 w-6" />
            Pacientes
          </h1>
          <p className="text-sm text-muted-foreground">
            {pacientes.length} paciente(s) • {dadosClinicos ? "Acesso clínico completo" : "Acesso administrativo (sem dados clínicos)"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={abrirCriar}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Paciente
          </Button>
        </div>
      </div>

      {/* Busca */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, Nº utente, telefone..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Erro */}
      {erro && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 pt-4 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{erro}</span>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Lista */}
      {!loading && pacientes.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <UserRound className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhum paciente encontrado. Cria o primeiro com &ldquo;Novo Paciente&rdquo;.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && pacientes.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pacientes.map((p) => (
            <Card
              key={p._id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setDetalhe(p)}
            >
              <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                          <UserRound className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{p.nome}</CardTitle>
                          <p className="text-xs text-muted-foreground">
                            {calcularIdade(p.data_nascimento)} • {p.num_utente || "Sem Nº utente"}
                          </p>
                        </div>
                      </div>
                      <Badge variant={p.ativo ? "success" : "secondary"}>
                        {p.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
              </CardHeader>
              <CardContent className="space-y-2 pt-0 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" />
                  <span>{p.telefone}</span>
                </div>
                {p.email && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    <span className="truncate">{p.email}</span>
                  </div>
                )}
                {dadosClinicos && p.alergias && p.alergias.length > 0 && (
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span className="text-xs">{p.alergias.join(", ")}</span>
                  </div>
                )}
                {p.consentimento_dados?.concedido ? (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span className="text-xs">Consentimento RGPD</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span className="text-xs">Sem consentimento RGPD</span>
                  </div>
                )}
              </CardContent>
              <div className="flex border-t">
                <button
                  className="flex flex-1 items-center justify-center gap-1 py-2 text-xs hover:bg-muted"
                  onClick={(e) => { e.stopPropagation(); abrirEditar(p); }}
                >
                  <Pencil className="h-3 w-3" /> Editar
                </button>
                <button
                  className="flex flex-1 items-center justify-center gap-1 py-2 text-xs hover:bg-muted"
                  onClick={(e) => { e.stopPropagation(); alternarEstado(p); }}
                >
                  <Power className="h-3 w-3" /> {p.ativo ? "Desativar" : "Ativar"}
                </button>
                <button
                  className="flex flex-1 items-center justify-center gap-1 py-2 text-xs text-destructive hover:bg-destructive/10"
                  onClick={(e) => { e.stopPropagation(); eliminar(p); }}
                >
                  <Trash2 className="h-3 w-3" /> Eliminar
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal Criar/Editar */}
      <Dialog open={mostrarForm} onOpenChange={setMostrarForm}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editandoId ? "Editar Paciente" : "Novo Paciente"}</DialogTitle>
            <DialogDescription>
              {editandoId
                ? "Atualiza os dados do paciente."
                : "Regista um novo paciente na clínica."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submeter} className="space-y-4">
            {formErro && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {formErro}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium">Nome *</label>
                <Input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Telefone *</label>
                <Input
                  value={form.telefone}
                  onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Email</label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Data de Nascimento</label>
                <Input
                  type="date"
                  value={form.data_nascimento}
                  onChange={(e) => setForm({ ...form, data_nascimento: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Género</label>
                <select
                  value={form.genero}
                  onChange={(e) => setForm({ ...form, genero: e.target.value as "M" | "F" | "Outro" | "NA" })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  <option value="NA">Não especificado</option>
                  <option value="M">Masculino</option>
                  <option value="F">Feminino</option>
                  <option value="Outro">Outro</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nº Utente (SNS)</label>
                <Input
                  value={form.num_utente}
                  onChange={(e) => setForm({ ...form, num_utente: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">NIF</label>
                <Input
                  value={form.nif}
                  onChange={(e) => setForm({ ...form, nif: e.target.value })}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium">Morada</label>
                <Input
                  value={form.morada}
                  onChange={(e) => setForm({ ...form, morada: e.target.value })}
                />
              </div>
            </div>

            {/* Campos clínicos — só para isClinico */}
            {dadosClinicos && (
              <div className="space-y-4 rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                  <ShieldCheck className="h-4 w-4" />
                  Dados Clínicos (acesso restrito)
                </h3>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Histórico Médico</label>
                  <textarea
                    value={form.historico_medico}
                    onChange={(e) => setForm({ ...form, historico_medico: e.target.value })}
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    placeholder="Patologias, medicação, cirurgias..."
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Alergias (separadas por vírgula)</label>
                  <Input
                    value={form.alergias}
                    onChange={(e) => setForm({ ...form, alergias: e.target.value })}
                    placeholder="Penicilina, Marisco, Ibuprofeno"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Contacto de Emergência</label>
                    <Input
                      value={form.contacto_emergencia_nome}
                      onChange={(e) => setForm({ ...form, contacto_emergencia_nome: e.target.value })}
                      placeholder="Nome"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Telefone</label>
                    <Input
                      value={form.contacto_emergencia_telefone}
                      onChange={(e) => setForm({ ...form, contacto_emergencia_telefone: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Relação</label>
                    <Input
                      value={form.contacto_emergencia_relacao}
                      onChange={(e) => setForm({ ...form, contacto_emergencia_relacao: e.target.value })}
                      placeholder="Filho, Cônjuge..."
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Observações</label>
              <textarea
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.consentimento}
                onChange={(e) => setForm({ ...form, consentimento: e.target.checked })}
                className="rounded"
              />
              Consentimento de tratamento de dados (RGPD)
            </label>

            <DialogFooter>
              <Button type="button" variant="outline" disabled={submitting} onClick={() => setMostrarForm(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editandoId ? "Guardar" : "Criar Paciente"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Detalhe */}
      <Dialog open={!!detalhe} onOpenChange={(v) => !v && setDetalhe(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserRound className="h-5 w-5" />
              {detalhe?.nome}
            </DialogTitle>
          </DialogHeader>
          {detalhe && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Telefone</p>
                  <p className="flex items-center gap-1"><Phone className="h-3 w-3" />{detalhe.telefone}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Email</p>
                  <p>{detalhe.email || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Data de Nascimento</p>
                  <p className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {detalhe.data_nascimento ? new Date(detalhe.data_nascimento).toLocaleDateString("pt-PT") : "—"}
                    {detalhe.data_nascimento && ` (${calcularIdade(detalhe.data_nascimento)})`}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Nº Utente</p>
                  <p>{detalhe.num_utente || "—"}</p>
                </div>
                {detalhe.nif && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">NIF</p>
                    <p>{detalhe.nif}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Estado</p>
                  <Badge variant={detalhe.ativo ? "success" : "secondary"}>
                    {detalhe.ativo ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
              </div>

              {detalhe.morada && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Morada</p>
                  <p>{detalhe.morada}</p>
                </div>
              )}

              {dadosClinicos && (
                <>
                  {detalhe.historico_medico && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Histórico Médico</p>
                      <p className="whitespace-pre-wrap">{detalhe.historico_medico}</p>
                    </div>
                  )}
                  {detalhe.alergias && detalhe.alergias.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Alergias</p>
                      <div className="flex flex-wrap gap-1">
                        {detalhe.alergias.map((a, i) => (
                          <Badge key={i} variant="destructive">{a}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {detalhe.contacto_emergencia?.nome && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Contacto de Emergência</p>
                      <p>
                        {detalhe.contacto_emergencia.nome}
                        {detalhe.contacto_emergencia.telefone && ` • ${detalhe.contacto_emergencia.telefone}`}
                        {detalhe.contacto_emergencia.relacao && ` • ${detalhe.contacto_emergencia.relacao}`}
                      </p>
                    </div>
                  )}
                </>
              )}

              {detalhe.observacoes && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Observações</p>
                  <p className="whitespace-pre-wrap">{detalhe.observacoes}</p>
                </div>
              )}

              <div className="flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
                <ShieldCheck className="h-3 w-3" />
                Consentimento RGPD: {detalhe.consentimento_dados?.concedido ? "Concedido" : "Não concedido"}
                {detalhe.consentimento_dados?.data && ` • ${new Date(detalhe.consentimento_dados.data).toLocaleDateString("pt-PT")}`}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => detalhe && abrirEditar(detalhe)}>
              <Pencil className="mr-2 h-4 w-4" /> Editar
            </Button>
            <Button onClick={() => setDetalhe(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
