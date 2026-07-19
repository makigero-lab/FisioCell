"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FileText,
  Upload,
  Loader2,
  AlertCircle,
  RefreshCw,
  Trash2,
  Download,
  Search,
  Paperclip,
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
  adminDelete,
  type DocumentoDTO,
  type DocumentoListResponse,
  type PacienteDTO,
  type PacienteListResponse,
  type TipoDocumento,
} from "@/lib/api";

/**
 * Página de Documentos — F9.
 *
 * Gestão de anexos clínicos: receitas, relatórios, termos de consentimento,
 * fotografias de documentos. Upload via multipart/form-data.
 *
 * Permissões: todos os 4 roles podem ver/carregar. Só diretor/admin eliminam.
 */

const TIPOS: Record<TipoDocumento, { label: string; icon: typeof FileText }> = {
  receita: { label: "Receita", icon: FileText },
  relatorio: { label: "Relatório", icon: FileText },
  termo_consentimento: { label: "Termo de Consentimento", icon: ShieldCheck },
  foto: { label: "Fotografia", icon: Paperclip },
  exame: { label: "Exame", icon: FileText },
  outro: { label: "Outro", icon: Paperclip },
};

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function nomePaciente(p: DocumentoDTO["paciente_id"]): string {
  return typeof p === "string" ? "Paciente" : p?.nome ?? "?";
}

export default function DocumentosPage() {
  const [documentos, setDocumentos] = useState<DocumentoDTO[]>([]);
  const [pacientes, setPacientes] = useState<PacienteDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Filtro
  const [filtroPaciente, setFiltroPaciente] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");

  // Modal upload
  const [mostrarUpload, setMostrarUpload] = useState(false);
  const [form, setForm] = useState({
    paciente_id: "",
    tipo: "outro" as TipoDocumento,
    descricao: "",
    consentimento: false,
  });
  const [ficheiro, setFicheiro] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formErro, setFormErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const params = new URLSearchParams();
      if (filtroPaciente) params.set("paciente_id", filtroPaciente);
      if (filtroTipo) params.set("tipo", filtroTipo);

      const [rDocs, rPacientes] = await Promise.all([
        adminGet<DocumentoListResponse>(`/gestor/documentos?${params}`),
        adminGet<PacienteListResponse>(`/gestor/pacientes`),
      ]);
      setDocumentos(rDocs.documentos || []);
      setPacientes(rPacientes.pacientes || []);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar documentos.");
    } finally {
      setLoading(false);
    }
  }, [filtroPaciente, filtroTipo]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function abrirUpload() {
    setForm({
      paciente_id: pacientes[0]?._id ?? "",
      tipo: "outro",
      descricao: "",
      consentimento: false,
    });
    setFicheiro(null);
    setFormErro(null);
    setMostrarUpload(true);
  }

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    setFormErro(null);
    if (!form.paciente_id) {
      setFormErro("Paciente é obrigatório.");
      return;
    }
    if (!ficheiro) {
      setFormErro("Seleciona um ficheiro.");
      return;
    }

    // Upload via FormData (multipart/form-data).
    const formData = new FormData();
    formData.append("file", ficheiro);
    formData.append("paciente_id", form.paciente_id);
    formData.append("tipo", form.tipo);
    formData.append("descricao", form.descricao);
    formData.append("consentimento_obtido", String(form.consentimento));

    setSubmitting(true);
    try {
      const res = await fetch("/api/gestor/documentos/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.erro || `Erro ${res.status}`);
      }
      setMostrarUpload(false);
      await carregar();
    } catch (e: unknown) {
      setFormErro(e instanceof Error ? e.message : "Erro ao carregar ficheiro.");
    } finally {
      setSubmitting(false);
    }
  }

  async function eliminar(d: DocumentoDTO) {
    if (!confirm(`Eliminar documento "${d.nome_original}"?`)) return;
    try {
      await adminDelete(`/gestor/documentos/${d._id}`);
      await carregar();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro ao eliminar documento.");
    }
  }

  async function download(d: DocumentoDTO) {
    try {
      const res = await fetch(`/api/gestor/documentos/${d._id}/download`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Erro no download");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = d.nome_original;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Erro no download.");
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <FileText className="h-6 w-6" />
            Documentos
          </h1>
          <p className="text-sm text-muted-foreground">
            {documentos.length} documento(s) • Receitas, relatórios, fotografias clínicas
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={abrirUpload}>
            <Upload className="mr-2 h-4 w-4" />
            Carregar Documento
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Paciente:</label>
          <select
            value={filtroPaciente}
            onChange={(e) => setFiltroPaciente(e.target.value)}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="">Todos</option>
            {pacientes.map((p) => (
              <option key={p._id} value={p._id}>{p.nome}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Tipo:</label>
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="">Todos</option>
            {Object.entries(TIPOS).map(([valor, { label }]) => (
              <option key={valor} value={valor}>{label}</option>
            ))}
          </select>
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

      {!loading && documentos.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhum documento. Carrega o primeiro com &ldquo;Carregar Documento&rdquo;.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Lista de documentos */}
      {!loading && documentos.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {documentos.map((d) => {
            const TipoIcon = TIPOS[d.tipo]?.icon ?? Paperclip;
            return (
              <Card key={d._id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                        <TipoIcon className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-sm">{d.nome_original}</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {nomePaciente(d.paciente_id)} • {formatarTamanho(d.tamanho_bytes)}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline">{TIPOS[d.tipo]?.label ?? d.tipo}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-0 text-sm">
                  {d.descricao && (
                    <p className="text-muted-foreground">{d.descricao}</p>
                  )}
                  {d.consentimento_obtido ? (
                    <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span className="text-xs">Consentimento RGPD</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span className="text-xs">Sem consentimento RGPD</span>
                    </div>
                  )}
                  <div className="flex gap-1 border-t pt-2">
                    <Button size="sm" variant="ghost" onClick={() => download(d)}>
                      <Download className="mr-1 h-3 w-3" /> Download
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => eliminar(d)}>
                      <Trash2 className="mr-1 h-3 w-3 text-destructive" /> Eliminar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal Upload */}
      <Dialog open={mostrarUpload} onOpenChange={setMostrarUpload}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Carregar Documento</DialogTitle>
            <DialogDescription>
              Anexa um ficheiro ao paciente (receita, relatório, fotografia, etc.).
              Aceita: PDF, JPEG, PNG, GIF, DOC/DOCX, TXT (máx. 20MB).
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

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tipo</label>
              <select
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoDocumento })}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                {Object.entries(TIPOS).map(([valor, { label }]) => (
                  <option key={valor} value={valor}>{label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Descrição (opcional)</label>
              <Input
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Ex.: Receita de anti-inflamatório"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Ficheiro *</label>
              <input
                type="file"
                onChange={(e) => setFicheiro(e.target.files?.[0] ?? null)}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.txt"
              />
              {ficheiro && (
                <p className="text-xs text-muted-foreground">
                  {ficheiro.name} ({formatarTamanho(ficheiro.size)})
                </p>
              )}
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
              <Button type="button" variant="outline" onClick={() => setMostrarUpload(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Carregar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
