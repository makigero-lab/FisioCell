"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Stethoscope,
  Plus,
  Loader2,
  AlertCircle,
  RefreshCw,
  Trash2,
  Pencil,
  ClipboardList,
  Activity,
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
  type ModeloProtocoloDTO,
  type ProtocoloListResponse,
  type AreaProtocolo,
} from "@/lib/api";

/**
 * Página de Protocolos Clínicos — F5.
 *
 * CRUD de modelos de protocolo clínico reutilizáveis.
 * Os protocolos são aplicados às Consultas (snapshot imutável na criação).
 *
 * Permissões: só diretor_clinico/admin podem criar/editar/eliminar.
 * Fisioterapeutas e rececionistas podem ver (para aplicar nas consultas).
 */

const AREAS: Record<AreaProtocolo, string> = {
  musculoesqueletica: "Musculoesquelética",
  neurologica: "Neurológica",
  cardioresp: "Cardiorrespiratória",
  desporto: "Desporto",
  pediatria: "Pediatria",
  outro: "Outro",
};

export default function ProtocolosPage() {
  const [protocolos, setProtocolos] = useState<ModeloProtocoloDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Filtro
  const [filtroArea, setFiltroArea] = useState("");

  // Modal criar/editar
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState({
    nome: "",
    descricao: "",
    area: "musculoesqueletica" as AreaProtocolo,
    seccoes: [{ nome: "", items: [""] }],
    ativo: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formErro, setFormErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const params = filtroArea ? `?area=${filtroArea}` : "";
      const data = await adminGet<ProtocoloListResponse>(`/gestor/protocolos${params}`);
      setProtocolos(data.protocolos || []);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar protocolos.");
    } finally {
      setLoading(false);
    }
  }, [filtroArea]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function abrirCriar() {
    setEditandoId(null);
    setForm({
      nome: "",
      descricao: "",
      area: "musculoesqueletica",
      seccoes: [{ nome: "", items: [""] }],
      ativo: true,
    });
    setFormErro(null);
    setMostrarForm(true);
  }

  function abrirEditar(p: ModeloProtocoloDTO) {
    setEditandoId(p._id);
    setForm({
      nome: p.nome,
      descricao: p.descricao,
      area: p.area,
      seccoes: p.seccoes.length > 0 ? p.seccoes.map((s) => ({ nome: s.nome, items: s.items.length > 0 ? s.items : [""] })) : [{ nome: "", items: [""] }],
      ativo: p.ativo,
    });
    setFormErro(null);
    setMostrarForm(true);
  }

  function adicionarSecao() {
    setForm({ ...form, seccoes: [...form.seccoes, { nome: "", items: [""] }] });
  }

  function removerSecao(idx: number) {
    setForm({ ...form, seccoes: form.seccoes.filter((_, i) => i !== idx) });
  }

  function adicionarItem(secIdx: number) {
    const novasSecoes = [...form.seccoes];
    novasSecoes[secIdx].items.push("");
    setForm({ ...form, seccoes: novasSecoes });
  }

  function removerItem(secIdx: number, itemIdx: number) {
    const novasSecoes = [...form.seccoes];
    novasSecoes[secIdx].items = novasSecoes[secIdx].items.filter((_, i) => i !== itemIdx);
    setForm({ ...form, seccoes: novasSecoes });
  }

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setFormErro(null);
    if (!form.nome.trim()) {
      setFormErro("Nome é obrigatório.");
      return;
    }
    // Limpa items vazios e remove secções sem items.
    const seccoesLimpa = form.seccoes
      .map((s) => ({
        nome: s.nome.trim(),
        items: s.items.map((i) => i.trim()).filter(Boolean),
      }))
      .filter((s) => s.nome && s.items.length > 0);

    if (seccoesLimpa.length === 0) {
      setFormErro("Pelo menos uma secção com items é obrigatória.");
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        nome: form.nome.trim(),
        descricao: form.descricao.trim(),
        area: form.area,
        seccoes: seccoesLimpa,
        ativo: form.ativo,
      };
      if (editandoId) {
        await adminPut(`/gestor/protocolos/${editandoId}`, body);
      } else {
        await adminPost(`/gestor/protocolos`, body);
      }
      setMostrarForm(false);
      await carregar();
    } catch (e: unknown) {
      setFormErro(e instanceof Error ? e.message : "Erro ao guardar protocolo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function eliminar(p: ModeloProtocoloDTO) {
    if (!confirm(`Eliminar protocolo "${p.nome}"?`)) return;
    try {
      await adminDelete(`/gestor/protocolos/${p._id}`);
      await carregar();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao eliminar protocolo.");
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Stethoscope className="h-6 w-6" />
            Protocolos Clínicos
          </h1>
          <p className="text-sm text-muted-foreground">
            {protocolos.length} protocolo(s) • Templates reutilizáveis aplicados às consultas
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={abrirCriar}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Protocolo
          </Button>
        </div>
      </div>

      {/* Filtro por área */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Filtrar por área:</label>
        <select
          value={filtroArea}
          onChange={(e) => setFiltroArea(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
        >
          <option value="">Todas</option>
          {Object.entries(AREAS).map(([valor, label]) => (
            <option key={valor} value={valor}>{label}</option>
          ))}
        </select>
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

      {!loading && protocolos.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Stethoscope className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhum protocolo definido. Cria o primeiro com &ldquo;Novo Protocolo&rdquo;.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Lista de protocolos */}
      {!loading && protocolos.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {protocolos.map((p) => (
            <Card key={p._id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <Activity className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{p.nome}</CardTitle>
                      <Badge variant="outline" className="mt-1 text-xs">
                        {AREAS[p.area]}
                      </Badge>
                    </div>
                  </div>
                  {!p.ativo && <Badge variant="secondary">Inativo</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 pt-0 text-sm">
                {p.descricao && (
                  <p className="text-muted-foreground">{p.descricao}</p>
                )}
                <div className="space-y-1">
                  {p.seccoes.map((sec, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <ClipboardList className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                      <div>
                        <span className="font-medium">{sec.nome}:</span>{" "}
                        <span className="text-muted-foreground">{sec.items.join(", ")}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1 border-t pt-2">
                  <Button size="sm" variant="ghost" onClick={() => abrirEditar(p)}>
                    <Pencil className="mr-1 h-3 w-3" /> Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => eliminar(p)}>
                    <Trash2 className="mr-1 h-3 w-3 text-destructive" /> Eliminar
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
            <DialogTitle>{editandoId ? "Editar Protocolo" : "Novo Protocolo"}</DialogTitle>
            <DialogDescription>
              Define um protocolo clínico reutilizável. Será aplicado como snapshot imutável nas consultas.
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
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nome *</label>
                <Input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex.: Avaliação Ombro"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Área Clínica</label>
                <select
                  value={form.area}
                  onChange={(e) => setForm({ ...form, area: e.target.value as AreaProtocolo })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  {Object.entries(AREAS).map(([valor, label]) => (
                    <option key={valor} value={valor}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Descrição</label>
              <Input
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Descrição opcional do protocolo"
              />
            </div>

            {/* Secções e items dinâmicos */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Secções e Items</label>
                <Button type="button" size="sm" variant="outline" onClick={adicionarSecao}>
                  <Plus className="mr-1 h-3 w-3" /> Secção
                </Button>
              </div>
              {form.seccoes.map((sec, secIdx) => (
                <div key={secIdx} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={sec.nome}
                      onChange={(e) => {
                        const novas = [...form.seccoes];
                        novas[secIdx].nome = e.target.value;
                        setForm({ ...form, seccoes: novas });
                      }}
                      placeholder="Nome da secção"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => removerSecao(secIdx)}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                  {sec.items.map((item, itemIdx) => (
                    <div key={itemIdx} className="flex items-center gap-2">
                      <Input
                        value={item}
                        onChange={(e) => {
                          const novas = [...form.seccoes];
                          novas[secIdx].items[itemIdx] = e.target.value;
                          setForm({ ...form, seccoes: novas });
                        }}
                        placeholder={`Item ${itemIdx + 1}`}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removerItem(secIdx, itemIdx)}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="outline" onClick={() => adicionarItem(secIdx)}>
                    <Plus className="mr-1 h-3 w-3" /> Item
                  </Button>
                </div>
              ))}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                className="rounded"
              />
              Protocolo ativo (disponível para aplicar em consultas)
            </label>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMostrarForm(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editandoId ? "Guardar" : "Criar Protocolo"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
