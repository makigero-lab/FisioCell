"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarRange,
  Loader2,
  AlertCircle,
  RefreshCw,
  Clock,
  User,
  Building2,
  X,
  Stethoscope,
} from "lucide-react";
import { format } from "date-fns";
import { pt } from "date-fns/locale";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import ptLocale from "@fullcalendar/core/locales/pt";
import type { DatesSetArg, EventClickArg, EventContentArg, EventInput } from "@fullcalendar/core";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  adminGet,
  type ConsultaDTO,
  type ConsultaListResponse,
  type UtilizadorDTO,
  type EstadoConsulta,
  type TipoConsulta,
} from "@/lib/api";

/**
 * Calendário de Consultas — F6.
 *
 * FullCalendar que mostra Consultas (em vez de Tarefas) com:
 *   - Cores por fisioterapeuta (perfil_profissional.cor_calendario)
 *   - Blocos com duração real (data_hora_inicio → data_hora_fim)
 *   - Filtros por fisioterapeuta, sala, estado
 *   - Modal de detalhe ao clicar
 *
 * Substitui o calendário antigo (/gestor/calendario) que mostrava Tarefas.
 */

/* ------------------------------------------------------------------ */
/* Tipos e constantes                                                  */
/* ------------------------------------------------------------------ */

interface FiltrosState {
  fisioterapeutaId: string;
  salaId: string;
  estado: string;
}

interface PeriodoState {
  inicio: string;
  fim: string;
}

const ESTADO_OPTS: { value: string; label: string; color: string }[] = [
  { value: "", label: "Todos os estados", color: "#6b7280" },
  { value: "marcada", label: "Marcada", color: "#3b82f6" },
  { value: "confirmada", label: "Confirmada", color: "#10b981" },
  { value: "em_curso", label: "Em curso", color: "#f59e0b" },
  { value: "concluida", label: "Concluída", color: "#6366f1" },
  { value: "cancelada", label: "Cancelada", color: "#ef4444" },
  { value: "faltou", label: "Faltou", color: "#dc2626" },
  { value: "nao_compareceu", label: "Não compareceu", color: "#991b1b" },
];

const TIPO_LABEL: Record<TipoConsulta, string> = {
  primeira_consulta: "1ª Consulta",
  sessao: "Sessão",
  reavaliacao: "Reavaliação",
  alta: "Alta",
  grupo: "Grupo",
};

const ESTADO_LABEL: Record<EstadoConsulta, string> = {
  marcada: "Marcada",
  confirmada: "Confirmada",
  em_curso: "Em curso",
  concluida: "Concluída",
  cancelada: "Cancelada",
  faltou: "Faltou",
  nao_compareceu: "Não compareceu",
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Cor do evento: prioridade da cor do fisioterapeuta, fallback por estado.
 */
function corEvento(c: ConsultaDTO): string {
  const fisio = typeof c.fisioterapeuta_id === "string" ? null : c.fisioterapeuta_id;
  if (fisio?.perfil_profissional?.cor_calendario) {
    return fisio.perfil_profissional.cor_calendario;
  }
  // Fallback: cor por estado.
  const opt = ESTADO_OPTS.find((e) => e.value === c.estado);
  return opt?.color ?? "#6b7280";
}

function nomeFisio(f: ConsultaDTO["fisioterapeuta_id"]): string {
  return typeof f === "string" ? "Fisioterapeuta" : f?.nome ?? "?";
}
function nomePaciente(p: ConsultaDTO["paciente_id"]): string {
  return typeof p === "string" ? "Paciente" : p?.nome ?? "?";
}
function nomeSala(s: ConsultaDTO["sala_id"]): string {
  return typeof s === "string" ? "Sala" : s?.nome ?? "?";
}

function formatarDataHora(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-PT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/* ------------------------------------------------------------------ */
/* Componente principal                                                */
/* ------------------------------------------------------------------ */

export default function CalendarioConsultasPage() {
  const [consultas, setConsultas] = useState<ConsultaDTO[]>([]);
  const [fisios, setFisios] = useState<UtilizadorDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [filtros, setFiltros] = useState<FiltrosState>({
    fisioterapeutaId: "",
    salaId: "",
    estado: "",
  });
  const [periodo, setPeriodo] = useState<PeriodoState>({
    inicio: "",
    fim: "",
  });

  // Modal detalhe
  const [detalhe, setDetalhe] = useState<ConsultaDTO | null>(null);

  const carregar = useCallback(async () => {
    if (!periodo.inicio || !periodo.fim) return;
    setLoading(true);
    setErro(null);
    try {
      const params = new URLSearchParams({
        inicio: periodo.inicio,
        fim: periodo.fim,
      });
      if (filtros.fisioterapeutaId) params.set("fisioterapeuta_id", filtros.fisioterapeutaId);
      if (filtros.salaId) params.set("sala_id", filtros.salaId);
      if (filtros.estado) params.set("estado", filtros.estado);

      const data = await adminGet<ConsultaListResponse>(`/gestor/consultas?${params}`);
      setConsultas(data.consultas || []);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar consultas.");
    } finally {
      setLoading(false);
    }
  }, [periodo, filtros]);

  // Carrega lista de fisios para o filtro.
  useEffect(() => {
    (async () => {
      try {
        const data = await adminGet<{ utilizadores: UtilizadorDTO[] }>(`/gestor/equipa`);
        setFisios(
          (data.utilizadores || []).filter(
            (u) => u.role === "fisioterapeuta" || u.role === "diretor_clinico"
          )
        );
      } catch {
        // Silencioso — o filtro fica vazio.
      }
    })();
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Converte Consultas em eventos FullCalendar.
  const eventos: EventInput[] = useMemo(() => {
    return consultas.map((c) => ({
      id: c._id,
      title: `${nomePaciente(c.paciente_id)} — ${nomeFisio(c.fisioterapeuta_id)}`,
      start: c.data_hora_inicio,
      end: c.data_hora_fim,
      backgroundColor: corEvento(c),
      borderColor: corEvento(c),
      textColor: "#ffffff",
      extendedProps: { consulta: c },
    }));
  }, [consultas]);

  function handleDatesSet(info: DatesSetArg) {
    setPeriodo({
      inicio: info.startStr,
      fim: info.endStr,
    });
  }

  function handleEventClick(info: EventClickArg) {
    const consulta = info.event.extendedProps.consulta as ConsultaDTO;
    setDetalhe(consulta);
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <CalendarRange className="h-6 w-6" />
            Calendário de Consultas
          </h1>
          <p className="text-sm text-muted-foreground">
            {consultas.length} consulta(s) no período • Cores por fisioterapeuta
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Erro */}
      {erro && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {erro}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Fisioterapeuta:</label>
          <select
            value={filtros.fisioterapeutaId}
            onChange={(e) => setFiltros({ ...filtros, fisioterapeutaId: e.target.value })}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="">Todos</option>
            {fisios.map((f) => (
              <option key={f._id} value={f._id}>{f.nome}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Estado:</label>
          <select
            value={filtros.estado}
            onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            {ESTADO_OPTS.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </div>
        {loading && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Legenda de cores por fisioterapeuta */}
      {fisios.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-medium text-muted-foreground">Cores:</span>
          {fisios.slice(0, 8).map((f) => (
            <span key={f._id} className="flex items-center gap-1">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: f.perfil_profissional?.cor_calendario || "#3b82f6" }}
              />
              {f.nome}
            </span>
          ))}
        </div>
      )}

      {/* FullCalendar */}
      <div className="rounded-lg border bg-background p-2">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          locale={ptLocale}
          initialView="timeGridWeek"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay",
          }}
          buttonText={{
            today: "Hoje",
            month: "Mês",
            week: "Semana",
            day: "Dia",
          }}
          slotMinTime="08:00:00"
          slotMaxTime="20:00:00"
          nowIndicator
          allDaySlot={false}
          events={eventos}
          datesSet={handleDatesSet}
          eventClick={handleEventClick}
          eventContent={renderEventContent}
          height="auto"
          contentHeight={600}
          expandRows
          dayMaxEvents={3}
        />
      </div>

      {/* Modal Detalhe */}
      <Dialog open={!!detalhe} onOpenChange={(v) => !v && setDetalhe(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarRange className="h-5 w-5" />
              {detalhe && nomePaciente(detalhe.paciente_id)}
            </DialogTitle>
          </DialogHeader>
          {detalhe && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Início</p>
                  <p className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatarDataHora(detalhe.data_hora_inicio)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Fim</p>
                  <p className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatarDataHora(detalhe.data_hora_fim)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Duração</p>
                  <p>{detalhe.duracao_minutos} min</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Tipo</p>
                  <Badge variant="outline">{TIPO_LABEL[detalhe.tipo]}</Badge>
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
                  <Badge
                    variant={detalhe.estado === "concluida" ? "success" : detalhe.estado === "cancelada" ? "destructive" : "secondary"}
                  >
                    {ESTADO_LABEL[detalhe.estado]}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Presença</p>
                  <Badge variant="outline">{detalhe.presenca}</Badge>
                </div>
              </div>

              {detalhe.nota_clinica?.subjetivo && (
                <div className="rounded-md border p-3">
                  <p className="flex items-center gap-1 text-xs font-semibold">
                    <Stethoscope className="h-3 w-3" /> Nota Clínica SOAP
                  </p>
                  {detalhe.nota_clinica.subjetivo && (
                    <p className="mt-1 text-xs"><span className="font-medium">S:</span> {detalhe.nota_clinica.subjetivo}</p>
                  )}
                  {detalhe.nota_clinica.avaliacao && (
                    <p className="text-xs"><span className="font-medium">A:</span> {detalhe.nota_clinica.avaliacao}</p>
                  )}
                  {detalhe.nota_clinica.tratamento_efetuado && (
                    <p className="text-xs"><span className="font-medium">Tratamento:</span> {detalhe.nota_clinica.tratamento_efetuado}</p>
                  )}
                </div>
              )}

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

/* ------------------------------------------------------------------ */
/* Render customizado de eventos (mostra nome + hora)                  */
/* ------------------------------------------------------------------ */

function renderEventContent(arg: EventContentArg) {
  const consulta = arg.event.extendedProps.consulta as ConsultaDTO;
  const horaInicio = new Date(arg.event.startStr).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const paciente = nomePaciente(consulta.paciente_id);

  return (
    <div className="flex h-full flex-col overflow-hidden p-1 text-xs">
      <div className="font-semibold leading-tight">
        {horaInicio} {paciente}
      </div>
      {arg.view.type === "timeGridWeek" && (
        <div className="opacity-80 leading-tight">
          {nomeFisio(consulta.fisioterapeuta_id)}
        </div>
      )}
    </div>
  );
}
