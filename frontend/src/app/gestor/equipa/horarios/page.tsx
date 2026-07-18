"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Clock,
  Plus,
  Loader2,
  AlertCircle,
  RefreshCw,
  Trash2,
  Pencil,
  Calendar,
  CalendarOff,
  Search,
  CheckCircle2,
  XCircle,
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
  adminDelete,
  type HorarioFisioterapeutaDTO,
  type HorarioListResponse,
  type DisponibilidadeResponse,
  type UtilizadorDTO,
} from "@/lib/api";

/**
 * Página de Horários de Fisioterapeutas — F3.
 *
 * Permite ao diretor clínico gerir os limites de agenda de cada fisio:
 *   - Regras recorrentes (seg-sex 9-13, 14-19, etc.)
 *   - Exceções (bloqueios para formação, horários extras)
 *
 * Também permite verificar a disponibilidade de um fisio para uma data/hora.
 *
 * Permissões: só diretor_clinico/admin podem criar/editar/eliminar.
 * Fisioterapeutas e rececionistas podem ver.
 */
const DIAS_SEMANA = [
  { valor: 0, label: "Domingo" },
  { valor: 1, label: "Segunda" },
  { valor: 2, label: "Terça" },
  { valor: 3, label: "Quarta" },
  { valor: 4, label: "Quinta" },
  { valor: 5, label: "Sexta" },
  { valor: 6, label: "Sábado" },
];

function nomeDia(dia: number | null): string {
  if (dia === null) return "—";
  return DIAS_SEMANA.find((d) => d.valor === dia)?.label ?? "?";
}

function nomeFisio(fisio: HorarioFisioterapeutaDTO["fisioterapeuta_id"]): string {
  if (typeof fisio === "string") return "Fisioterapeuta";
  return fisio?.nome ?? "Fisioterapeuta";
}

function fisioId(fisio: HorarioFisioterapeutaDTO["fisioterapeuta_id"]): string {
  if (typeof fisio === "string") return fisio;
  return fisio?._id ?? "";
}

export default function HorariosPage() {
  const [horarios, setHorarios] = useState<HorarioFisioterapeutaDTO[]>([]);
  const [fisios, setFisios] = useState<UtilizadorDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Filtro
  const [filtroFisio, setFiltroFisio] = useState("");

  // Modal criar/editar
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState({
    fisioterapeuta_id: "",
    tipo: "recorrente" as "recorrente" | "excecao",
    dia_semana: 1,
    hora_inicio: "09:00",
    hora_fim: "13:00",
    data: "",
    disponivel: true,
    nota: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [formErro, setFormErro] = useState<string | null>(null);

  // Verificar disponibilidade
  const [checkFisio, setCheckFisio] = useState("");
  const [checkData, setCheckData] = useState("");
  const [checkHora, setCheckHora] = useState("10:00");
  const [checkDuracao, setCheckDuracao] = useState("45");
  const [checkResult, setCheckResult] = useState<DisponibilidadeResponse | null>(null);
  const [checking, setChecking] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const params = filtroFisio ? `?fisioterapeuta_id=${encodeURIComponent(filtroFisio)}` : "";
      const [rHorarios, rFisios] = await Promise.all([
        adminGet<HorarioListResponse>(`/gestor/horarios${params}`),
        adminGet<{ utilizadores: UtilizadorDTO[] }>(`/gestor/equipa`),
      ]);
      setHorarios(rHorarios.horarios || []);
      // Filtra só fisioterapeutas e diretores clínicos.
      setFisios(
        (rFisios.utilizadores || []).filter(
          (u) => u.role === "fisioterapeuta" || u.role === "diretor_clinico"
        )
      );
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar horários.");
    } finally {
      setLoading(false);
    }
  }, [filtroFisio]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function abrirCriar() {
    setEditandoId(null);
    setForm({
      fisioterapeuta_id: fisios[0]?._id ?? "",
      tipo: "recorrente",
      dia_semana: 1,
      hora_inicio: "09:00",
      hora_fim: "13:00",
      data: "",
      disponivel: true,
      nota: "",
    });
    setFormErro(null);
    setMostrarForm(true);
  }

  function abrirEditar(h: HorarioFisioterapeutaDTO) {
    setEditandoId(h._id);
    setForm({
      fisioterapeuta_id: fisioId(h.fisioterapeuta_id),
      tipo: h.tipo,
      dia_semana: h.dia_semana ?? 1,
      hora_inicio: h.hora_inicio,
      hora_fim: h.hora_fim,
      data: h.data ? h.data.split("T")[0] : "",
      disponivel: h.disponivel,
      nota: h.nota,
    });
    setFormErro(null);
    setMostrarForm(true);
  }

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setFormErro(null);
    if (!form.fisioterapeuta_id) {
      setFormErro("Fisioterapeuta é obrigatório.");
      return;
    }
    if (form.tipo === "excecao" && !form.data) {
      setFormErro("Data é obrigatória para exceções.");
      return;
    }

    const body: Record<string, unknown> = {
      fisioterapeuta_id: form.fisioterapeuta_id,
      tipo: form.tipo,
      hora_inicio: form.hora_inicio,
      hora_fim: form.hora_fim,
      disponivel: form.disponivel,
      nota: form.nota,
    };
    if (form.tipo === "recorrente") {
      body.dia_semana = Number(form.dia_semana);
    } else {
      body.data = form.data;
    }

    setSubmitting(true);
    try {
      if (editandoId) {
        await adminPut(`/gestor/horarios/${editandoId}`, body);
      } else {
        await adminPost(`/gestor/horarios`, body);
      }
      setMostrarForm(false);
      await carregar();
    } catch (e: unknown) {
      setFormErro(e instanceof Error ? e.message : "Erro ao guardar horário.");
    } finally {
      setSubmitting(false);
    }
  }

  async function eliminar(h: HorarioFisioterapeutaDTO) {
    if (!confirm(`Eliminar horário de ${nomeFisio(h.fisioterapeuta_id)}?`)) return;
    try {
      await adminDelete(`/gestor/horarios/${h._id}`);
      await carregar();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao eliminar horário.");
    }
  }

  async function verificarDisponibilidade() {
    if (!checkFisio || !checkData) return;
    setChecking(true);
    setCheckResult(null);
    try {
      // Combina data + hora num ISO string.
      const iso = `${checkData}T${checkHora}:00`;
      const res = await adminGet<DisponibilidadeResponse>(
        `/gestor/horarios/disponibilidade?fisioterapeuta_id=${checkFisio}&data=${encodeURIComponent(iso)}&duracao_minutos=${checkDuracao}`
      );
      setCheckResult(res);
    } catch (e: unknown) {
      setCheckResult({
        disponivel: false,
        horario: null,
        motivo: e instanceof Error ? e.message : "Erro ao verificar.",
        origem: null,
      });
    } finally {
      setChecking(false);
    }
  }

  // Agrupa horários por fisioterapeuta.
  const horariosPorFisio = horarios.reduce((acc, h) => {
    const id = fisioId(h.fisioterapeuta_id);
    if (!acc[id]) acc[id] = { nome: nomeFisio(h.fisioterapeuta_id), horarios: [] };
    acc[id].horarios.push(h);
    return acc;
  }, {} as Record<string, { nome: string; horarios: HorarioFisioterapeutaDTO[] }>);

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Clock className="h-6 w-6" />
            Horários de Fisioterapeutas
          </h1>
          <p className="text-sm text-muted-foreground">
            Define os limites de agenda (regras recorrentes e exceções).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={abrirCriar}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Horário
          </Button>
        </div>
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

      {/* Verificador de disponibilidade */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" />
            Verificar Disponibilidade
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Fisioterapeuta</label>
              <select
                value={checkFisio}
                onChange={(e) => setCheckFisio(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="">Selecionar...</option>
                {fisios.map((f) => (
                  <option key={f._id} value={f._id}>{f.nome}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Data</label>
              <Input
                type="date"
                value={checkData}
                onChange={(e) => setCheckData(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Hora</label>
              <Input
                type="time"
                value={checkHora}
                onChange={(e) => setCheckHora(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Duração (min)</label>
              <Input
                type="number"
                min="15"
                value={checkDuracao}
                onChange={(e) => setCheckDuracao(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                size="sm"
                onClick={verificarDisponibilidade}
                disabled={checking || !checkFisio || !checkData}
                className="w-full"
              >
                {checking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verificar
              </Button>
            </div>
          </div>
          {checkResult && (
            <div className={`flex items-start gap-2 rounded-md p-3 text-sm ${
              checkResult.disponivel
                ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400"
                : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
            }`}>
              {checkResult.disponivel ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div>
                <p className="font-medium">
                  {checkResult.disponivel ? "Disponível" : "Indisponível"}
                  {checkResult.horario && ` (${checkResult.horario.hora_inicio}-${checkResult.horario.hora_fim})`}
                  {checkResult.origem && ` • ${checkResult.origem}`}
                </p>
                {checkResult.motivo && <p className="text-xs opacity-80">{checkResult.motivo}</p>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filtro por fisio */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Filtrar por fisioterapeuta:</label>
        <select
          value={filtroFisio}
          onChange={(e) => setFiltroFisio(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
        >
          <option value="">Todos</option>
          {fisios.map((f) => (
            <option key={f._id} value={f._id}>{f.nome}</option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Lista agrupada por fisio */}
      {!loading && Object.keys(horariosPorFisio).length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Clock className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhum horário definido. Cria o primeiro com &ldquo;Novo Horário&rdquo;.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && Object.keys(horariosPorFisio).length > 0 && (
        <div className="space-y-4">
          {Object.entries(horariosPorFisio).map(([fisioIdKey, grupo]) => (
            <Card key={fisioIdKey}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{grupo.nome}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {grupo.horarios.map((h) => (
                  <div
                    key={h._id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {h.tipo === "recorrente" ? (
                        <Badge variant="secondary" className="gap-1">
                          <Calendar className="h-3 w-3" />
                          {nomeDia(h.dia_semana)}
                        </Badge>
                      ) : (
                        <Badge variant={h.disponivel ? "default" : "destructive"} className="gap-1">
                          <CalendarOff className="h-3 w-3" />
                          {h.data ? new Date(h.data).toLocaleDateString("pt-PT") : "—"}
                        </Badge>
                      )}
                      <span className="text-sm font-medium">
                        {h.hora_inicio} - {h.hora_fim}
                      </span>
                      {h.tipo === "excecao" && !h.disponivel && (
                        <Badge variant="destructive">Indisponível</Badge>
                      )}
                      {!h.ativo && <Badge variant="outline">Inativo</Badge>}
                      {h.nota && (
                        <span className="text-xs text-muted-foreground">• {h.nota}</span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => abrirEditar(h)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => eliminar(h)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Modal Criar/Editar */}
      <Dialog open={mostrarForm} onOpenChange={setMostrarForm}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editandoId ? "Editar Horário" : "Novo Horário"}</DialogTitle>
            <DialogDescription>
              Define quando o fisioterapeuta está disponível para consultas.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submeter} className="space-y-4">
            {formErro && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {formErro}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Fisioterapeuta *</label>
              <select
                value={form.fisioterapeuta_id}
                onChange={(e) => setForm({ ...form, fisioterapeuta_id: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                disabled={!!editandoId}
              >
                <option value="">Selecionar...</option>
                {fisios.map((f) => (
                  <option key={f._id} value={f._id}>{f.nome} ({f.role})</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tipo</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`flex-1 rounded-md border p-2 text-sm ${
                    form.tipo === "recorrente" ? "border-primary bg-primary/10" : "border-input"
                  }`}
                  onClick={() => setForm({ ...form, tipo: "recorrente" })}
                >
                  Recorrente (semanal)
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-md border p-2 text-sm ${
                    form.tipo === "excecao" ? "border-primary bg-primary/10" : "border-input"
                  }`}
                  onClick={() => setForm({ ...form, tipo: "excecao" })}
                >
                  Exceção (dia específico)
                </button>
              </div>
            </div>

            {form.tipo === "recorrente" ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Dia da semana *</label>
                <select
                  value={form.dia_semana}
                  onChange={(e) => setForm({ ...form, dia_semana: Number(e.target.value) })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  {DIAS_SEMANA.map((d) => (
                    <option key={d.valor} value={d.valor}>{d.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Data *</label>
                  <Input
                    type="date"
                    value={form.data}
                    onChange={(e) => setForm({ ...form, data: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.disponivel}
                    onChange={(e) => setForm({ ...form, disponivel: e.target.checked })}
                    className="rounded"
                  />
                  Disponível (se desmarcado, bloqueia o dia)
                </label>
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Hora início *</label>
                <Input
                  type="time"
                  value={form.hora_inicio}
                  onChange={(e) => setForm({ ...form, hora_inicio: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Hora fim *</label>
                <Input
                  type="time"
                  value={form.hora_fim}
                  onChange={(e) => setForm({ ...form, hora_fim: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nota (opcional)</label>
              <Input
                value={form.nota}
                onChange={(e) => setForm({ ...form, nota: e.target.value })}
                placeholder="Ex.: Formação em Pilates Clínico"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMostrarForm(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editandoId ? "Guardar" : "Criar Horário"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
