"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarPlus,
  Calendar,
  Loader2,
  AlertCircle,
  RefreshCw,
  Trash2,
  Pencil,
  Search,
  Clock,
  User,
  Building2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Stethoscope,
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
  type ConsultaDTO,
  type ConsultaListResponse,
  type ValidarConflitosResponse,
  type UtilizadorDTO,
  type PacienteDTO,
  type PacienteListResponse,
  type PropriedadeDTO,
  type EstadoConsulta,
  type TipoConsulta,
} from "@/lib/api";

/**
 * Página de Consultas — F4.
 *
 * CRUD completo de marcações com validação de conflitos em tempo real:
 *   - Fisioterapeuta disponível (motor F3)
 *   - Sala sem sobreposição
 *   - Fisioterapeuta sem sobreposição
 *   - Paciente sem sobreposição
 *
 * Permissões:
 *   - isRececionista: criar/editar marcações.
 *   - isClinico (fisio): ver as suas, editar nota clínica SOAP.
 *   - isDiretorClinico: eliminar.
 */

const ESTADOS: Record<EstadoConsulta, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" }> = {
  marcada: { label: "Marcada", variant: "secondary" },
  confirmada: { label: "Confirmada", variant: "default" },
  em_curso: { label: "Em curso", variant: "default" },
  concluida: { label: "Concluída", variant: "success" },
  cancelada: { label: "Cancelada", variant: "destructive" },
  faltou: { label: "Faltou", variant: "destructive" },
  nao_compareceu: { label: "Não compareceu", variant: "destructive" },
};

const TIPOS: Record<TipoConsulta, string> = {
  primeira_consulta: "1ª Consulta",
  sessao: "Sessão",
  reavaliacao: "Reavaliação",
  alta: "Alta",
  grupo: "Grupo",
};

function nomeFisio(f: ConsultaDTO["fisioterapeuta_id"]): string {
  return typeof f === "string" ? "Fisioterapeuta" : f?.nome ?? "?";
}
function nomePaciente(p: ConsultaDTO["paciente_id"]): string {
  return typeof p === "string" ? "Paciente" : p?.nome ?? "?";
}
function nomeSala(s: ConsultaDTO["sala_id"]): string {
  return typeof s === "string" ? "Sala" : s?.nome ?? "?";
}
function idFisio(f: ConsultaDTO["fisioterapeuta_id"]): string {
  return typeof f === "string" ? f : f?._id ?? "";
}

function formatarData(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-PT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function soData(iso: string): string {
  try {
    return new Date(iso).toISOString().split("T")[0];
  } catch {
    return "";
  }
}

function soHora(iso: string): string {
  try {
    return new Date(iso).toTimeString().split(" ")[0].slice(0, 5);
  } catch {
    return "10:00";
  }
}

export default function ConsultasPage() {
  const [consultas, setConsultas] = useState<ConsultaDTO[]>([]);
  const [fisios, setFisios] = useState<UtilizadorDTO[]>([]);
  const [pacientes, setPacientes] = useState<PacienteDTO[]>([]);
  const [salas, setSalas] = useState<PropriedadeDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Modal criar/editar
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState({
    fisioterapeuta_id: "",
    sala_id: "",
    paciente_id: "",
    data: "",
    hora: "10:00",
    duracao_minutos: "45",
    tipo: "sessao" as TipoConsulta,
    observacoes: "",
  });
  const [conflitos, setConflitos] = useState<string[]>([]);
  const [validando, setValidando] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formErro, setFormErro] = useState<string | null>(null);

  // Modal detalhe + nota clínica
  const [detalhe, setDetalhe] = useState<ConsultaDTO | null>(null);
  const [notaEdit, setNotaEdit] = useState(false);
  const [notaForm, setNotaForm] = useState({
    subjetivo: "",
    objetivo: "",
    avaliacao: "",
    plano: "",
    tratamento_efetuado: "",
  });
  const [notaErro, setNotaErro] = useState<string | null>(null);
  const [notaSaving, setNotaSaving] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const [rConsultas, rFisios, rPacientes, rSalas] = await Promise.all([
        adminGet<ConsultaListResponse>(`/gestor/consultas`),
        adminGet<{ utilizadores: UtilizadorDTO[] }>(`/gestor/equipa`),
        adminGet<PacienteListResponse>(`/gestor/pacientes`),
        adminGet<{ propriedades: PropriedadeDTO[] }>(`/gestor/propriedades`),
      ]);
      setConsultas(rConsultas.consultas || []);
      setFisios((rFisios.utilizadores || []).filter((u) => u.role === "fisioterapeuta" || u.role === "diretor_clinico"));
      setPacientes(rPacientes.pacientes || []);
      setSalas(rSalas.propriedades || []);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar consultas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Valida conflitos em tempo real quando o formulário muda.
  useEffect(() => {
    if (!form.fisioterapeuta_id || !form.sala_id || !form.paciente_id || !form.data) {
      setConflitos([]);
      return;
    }
    const timer = setTimeout(async () => {
      setValidando(true);
      try {
        const iso = `${form.data}T${form.hora}:00`;
        const params = `?fisioterapeuta_id=${form.fisioterapeuta_id}&sala_id=${form.sala_id}&paciente_id=${form.paciente_id}&data_hora_inicio=${encodeURIComponent(iso)}&duracao_minutos=${form.duracao_minutos}${editandoId ? `&excluir_id=${editandoId}` : ""}`;
        const res = await adminGet<ValidarConflitosResponse>(`/gestor/consultas/validar${params}`);
        setConflitos(res.conflitos || []);
      } catch {
        setConflitos([]);
      } finally {
        setValidando(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [form.fisioterapeuta_id, form.sala_id, form.paciente_id, form.data, form.hora, form.duracao_minutos, editandoId]);

  function abrirCriar() {
    setEditandoId(null);
    setForm({
      fisioterapeuta_id: fisios[0]?._id ?? "",
      sala_id: salas[0]?._id ?? "",
      paciente_id: pacientes[0]?._id ?? "",
      data: new Date(Date.now() + 86400000).toISOString().split("T")[0], // amanhã
      hora: "10:00",
      duracao_minutos: "45",
      tipo: "sessao",
      observacoes: "",
    });
    setConflitos([]);
    setFormErro(null);
    setMostrarForm(true);
  }

  function abrirEditar(c: ConsultaDTO) {
    setEditandoId(c._id);
    setForm({
      fisioterapeuta_id: idFisio(c.fisioterapeuta_id),
      sala_id: typeof c.sala_id === "string" ? c.sala_id : c.sala_id._id,
      paciente_id: typeof c.paciente_id === "string" ? c.paciente_id : c.paciente_id._id,
      data: soData(c.data_hora_inicio),
      hora: soHora(c.data_hora_inicio),
      duracao_minutos: String(c.duracao_minutos),
      tipo: c.tipo,
      observacoes: c.observacoes ?? "",
    });
    setConflitos([]);
    setFormErro(null);
    setMostrarForm(true);
  }

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setFormErro(null);
    if (!form.fisioterapeuta_id || !form.sala_id || !form.paciente_id || !form.data) {
      setFormErro("Preencha todos os campos obrigatórios.");
      return;
    }

    const iso = `${form.data}T${form.hora}:00`;
    const body: Record<string, unknown> = {
      fisioterapeuta_id: form.fisioterapeuta_id,
      sala_id: form.sala_id,
      paciente_id: form.paciente_id,
      data_hora_inicio: iso,
      duracao_minutos: Number(form.duracao_minutos),
      tipo: form.tipo,
      observacoes: form.observacoes,
      forcar: conflitos.length > 0, // força se houver conflitos
    };

    setSubmitting(true);
    try {
      if (editandoId) {
        await adminPut(`/gestor/consultas/${editandoId}`, body);
      } else {
        await adminPost(`/gestor/consultas`, body);
      }
      setMostrarForm(false);
      await carregar();
    } catch (e: unknown) {
      setFormErro(e instanceof Error ? e.message : "Erro ao guardar consulta.");
    } finally {
      setSubmitting(false);
    }
  }

  async function alterarEstado(c: ConsultaDTO, novoEstado: EstadoConsulta) {
    try {
      await adminPut(`/gestor/consultas/${c._id}`, { estado: novoEstado });
      await carregar();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao alterar estado.");
    }
  }

  async function eliminar(c: ConsultaDTO) {
    if (!confirm(`Eliminar consulta de ${nomePaciente(c.paciente_id)}?`)) return;
    try {
      await adminDelete(`/gestor/consultas/${c._id}`);
      await carregar();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao eliminar consulta.");
    }
  }

  function abrirDetalhe(c: ConsultaDTO) {
    setDetalhe(c);
    setNotaEdit(false);
    setNotaForm({
      subjetivo: c.nota_clinica?.subjetivo ?? "",
      objetivo: c.nota_clinica?.objetivo ?? "",
      avaliacao: c.nota_clinica?.avaliacao ?? "",
      plano: c.nota_clinica?.plano ?? "",
      tratamento_efetuado: c.nota_clinica?.tratamento_efetuado ?? "",
    });
    setNotaErro(null);
  }

  async function guardarNota() {
    if (!detalhe) return;
    setNotaSaving(true);
    setNotaErro(null);
    try {
      await adminPatch(`/gestor/consultas/${detalhe._id}/nota-clinica`, notaForm);
      // Recarrega a consulta para mostrar a nota atualizada.
      const r = await adminGet<{ consulta: ConsultaDTO }>(`/gestor/consultas/${detalhe._id}`);
      setDetalhe(r.consulta);
      setNotaEdit(false);
      await carregar();
    } catch (e: unknown) {
      setNotaErro(e instanceof Error ? e.message : "Erro ao guardar nota clínica.");
    } finally {
      setNotaSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Calendar className="h-6 w-6" />
            Consultas
          </h1>
          <p className="text-sm text-muted-foreground">
            {consultas.length} consulta(s) marcada(s)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={abrirCriar}>
            <CalendarPlus className="mr-2 h-4 w-4" />
            Nova Consulta
          </Button>
        </div>
      </div>

      {erro && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 pt-4 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{erro}</span>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && consultas.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Calendar className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhuma consulta marcada. Cria a primeira com &ldquo;Nova Consulta&rdquo;.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && consultas.length > 0 && (
        <div className="space-y-3">
          {consultas.map((c) => (
            <Card
              key={c._id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => abrirDetalhe(c)}
            >
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <Calendar className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{nomePaciente(c.paciente_id)}</p>
                      <Badge variant={ESTADOS[c.estado].variant}>
                        {ESTADOS[c.estado].label}
                      </Badge>
                      <Badge variant="outline">{TIPOS[c.tipo]}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatarData(c.data_hora_inicio)} • {c.duracao_minutos}min
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" /> {nomeFisio(c.fisioterapeuta_id)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3 w-3" /> {nomeSala(c.sala_id)}
                  </span>
                  {c.nota_clinica?.subjetivo && (
                    <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                      <Stethoscope className="h-3 w-3" /> SOAP
                    </span>
                  )}
                </div>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  {c.estado !== "concluida" && c.estado !== "cancelada" && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => abrirEditar(c)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {c.estado === "marcada" && (
                        <Button size="sm" variant="ghost" onClick={() => alterarEstado(c, "confirmada")}>
                          Confirmar
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => alterarEstado(c, "concluida")}>
                        Concluir
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => eliminar(c)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Modal Criar/Editar */}
      <Dialog open={mostrarForm} onOpenChange={setMostrarForm}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editandoId ? "Editar Consulta" : "Nova Consulta"}</DialogTitle>
            <DialogDescription>
              Marca uma consulta de fisioterapia. A validação de conflitos corre em tempo real.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submeter} className="space-y-4">
            {formErro && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {formErro}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Fisioterapeuta *</label>
                <select
                  value={form.fisioterapeuta_id}
                  onChange={(e) => setForm({ ...form, fisioterapeuta_id: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="">Selecionar...</option>
                  {fisios.map((f) => (
                    <option key={f._id} value={f._id}>{f.nome}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Sala *</label>
                <select
                  value={form.sala_id}
                  onChange={(e) => setForm({ ...form, sala_id: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="">Selecionar...</option>
                  {salas.map((s) => (
                    <option key={s._id} value={s._id}>{s.nome}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Paciente *</label>
                <select
                  value={form.paciente_id}
                  onChange={(e) => setForm({ ...form, paciente_id: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="">Selecionar...</option>
                  {pacientes.map((p) => (
                    <option key={p._id} value={p._id}>{p.nome}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Data *</label>
                <Input
                  type="date"
                  value={form.data}
                  onChange={(e) => setForm({ ...form, data: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Hora *</label>
                <Input
                  type="time"
                  value={form.hora}
                  onChange={(e) => setForm({ ...form, hora: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Duração (min)</label>
                <Input
                  type="number"
                  min="15"
                  value={form.duracao_minutos}
                  onChange={(e) => setForm({ ...form, duracao_minutos: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tipo</label>
                <select
                  value={form.tipo}
                  onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoConsulta })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="sessao">Sessão</option>
                  <option value="primeira_consulta">1ª Consulta</option>
                  <option value="reavaliacao">Reavaliação</option>
                  <option value="alta">Alta</option>
                  <option value="grupo">Grupo</option>
                </select>
              </div>
            </div>

            {/* Validação de conflitos em tempo real */}
            {validando && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> A verificar disponibilidade...
              </div>
            )}
            {!validando && conflitos.length === 0 && form.fisioterapeuta_id && form.sala_id && form.paciente_id && form.data && (
              <div className="flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Sem conflitos — fisioterapeuta e sala disponíveis.
              </div>
            )}
            {conflitos.length > 0 && (
              <div className="space-y-2 rounded-md bg-amber-50 p-3 dark:bg-amber-950/30">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  Conflitos detetados ({conflitos.length}):
                </div>
                <ul className="ml-6 list-disc text-xs text-amber-700 dark:text-amber-400">
                  {conflitos.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Podes forçar o agendamento (botão abaixo) ou escolher outro horário.
                </p>
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

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMostrarForm(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editandoId ? "Guardar" : conflitos.length > 0 ? "Forçar Agendamento" : "Criar Consulta"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Detalhe + Nota Clínica */}
      <Dialog open={!!detalhe} onOpenChange={(v) => !v && setDetalhe(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              {detalhe && nomePaciente(detalhe.paciente_id)}
            </DialogTitle>
          </DialogHeader>
          {detalhe && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Data/Hora</p>
                  <p className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatarData(detalhe.data_hora_inicio)} ({detalhe.duracao_minutos}min)
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Tipo</p>
                  <Badge variant="outline">{TIPOS[detalhe.tipo]}</Badge>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Fisioterapeuta</p>
                  <p className="flex items-center gap-1">
                    <User className="h-3 w-3" /> {nomeFisio(detalhe.fisioterapeuta_id)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Sala</p>
                  <p className="flex items-center gap-1">
                    <Building2 className="h-3 w-3" /> {nomeSala(detalhe.sala_id)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Estado</p>
                  <Badge variant={ESTADOS[detalhe.estado].variant}>{ESTADOS[detalhe.estado].label}</Badge>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Presença</p>
                  <Badge variant="outline">{detalhe.presenca}</Badge>
                </div>
              </div>

              {/* Nota clínica SOAP */}
              <div className="space-y-3 rounded-md border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Stethoscope className="h-4 w-4" />
                    Nota Clínica (SOAP)
                  </h3>
                  {detalhe.estado !== "concluida" && !notaEdit && (
                    <Button size="sm" variant="outline" onClick={() => setNotaEdit(true)}>
                      <Pencil className="mr-1 h-3 w-3" /> Editar
                    </Button>
                  )}
                </div>

                {detalhe.nota_clinica?.cedula_assinante && (
                  <p className="text-xs text-muted-foreground">
                    Assinado por cédula: {detalhe.nota_clinica.cedula_assinante}
                  </p>
                )}

                {notaEdit ? (
                  <div className="space-y-3">
                    {notaErro && (
                      <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                        <AlertCircle className="h-3 w-3" /> {notaErro}
                      </div>
                    )}
                    {([
                      ["subjetivo", "S — Subjetivo"],
                      ["objetivo", "O — Objetivo"],
                      ["avaliacao", "A — Avaliação"],
                      ["plano", "P — Plano"],
                      ["tratamento_efetuado", "Tratamento Efetuado"],
                    ] as const).map(([key, label]) => (
                      <div key={key} className="space-y-1">
                        <label className="text-xs font-medium">{label}</label>
                        <textarea
                          value={notaForm[key]}
                          onChange={(e) => setNotaForm({ ...notaForm, [key]: e.target.value })}
                          className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setNotaEdit(false)}>
                        Cancelar
                      </Button>
                      <Button size="sm" onClick={guardarNota} disabled={notaSaving}>
                        {notaSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        Guardar SOAP
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-xs">
                    <div>
                      <p className="font-medium">S — Subjetivo</p>
                      <p className="text-muted-foreground">{detalhe.nota_clinica?.subjetivo || "—"}</p>
                    </div>
                    <div>
                      <p className="font-medium">O — Objetivo</p>
                      <p className="text-muted-foreground">{detalhe.nota_clinica?.objetivo || "—"}</p>
                    </div>
                    <div>
                      <p className="font-medium">A — Avaliação</p>
                      <p className="text-muted-foreground">{detalhe.nota_clinica?.avaliacao || "—"}</p>
                    </div>
                    <div>
                      <p className="font-medium">P — Plano</p>
                      <p className="text-muted-foreground">{detalhe.nota_clinica?.plano || "—"}</p>
                    </div>
                    <div>
                      <p className="font-medium">Tratamento Efetuado</p>
                      <p className="text-muted-foreground">{detalhe.nota_clinica?.tratamento_efetuado || "—"}</p>
                    </div>
                  </div>
                )}
              </div>

              {detalhe.observacoes && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Observações</p>
                  <p className="whitespace-pre-wrap">{detalhe.observacoes}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetalhe(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
