"use client";

import { ChevronDown, ChevronRight, Layers, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";

import { ActiveBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Textarea, Toggle } from "@/components/ui/Form";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import type { ToolTypeItem } from "@/app/api/tools/route";
import { LIMITS } from "@/lib/constants";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api/client";
import { formatDate, formatNumber, slugify } from "@/lib/utils/format";

interface ToolsResponse {
  tools: ToolTypeItem[];
  public_key: string | null;
}

interface ToolFormState {
  id: string | null;
  name: string;
  slug: string;
  slugTouched: boolean;
  isActive: boolean;
  hasSecret: boolean;
  editingSecret: boolean;
  secret: string;
}

const EMPTY_FORM: ToolFormState = {
  id: null,
  name: "",
  slug: "",
  slugTouched: false,
  isActive: true,
  hasSecret: false,
  editingSecret: false,
  secret: "",
};

export function ToolsView() {
  const toast = useToast();

  const [tools, setTools] = useState<ToolTypeItem[]>([]);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ToolFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ToolTypeItem | null>(null);
  const [versionTarget, setVersionTarget] = useState<ToolTypeItem | null>(null);
  const [versionName, setVersionName] = useState("");
  const [versionToDelete, setVersionToDelete] = useState<{ tool: ToolTypeItem; versionId: string; name: string } | null>(null);
  const [versionToEdit, setVersionToEdit] = useState<{ tool: ToolTypeItem; versionId: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (initial = false) => {
      if (initial) setLoading(true);
      else setReloading(true);
      try {
        const response = await apiGet<ToolsResponse>("/api/tools");
        setTools(response.tools);
        setPublicKey(response.public_key);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Gagal memuat daftar tool");
      } finally {
        setLoading(false);
        setReloading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (tool: ToolTypeItem) => {
    setForm({
      id: tool.id,
      name: tool.name,
      slug: tool.slug,
      slugTouched: true,
      isActive: tool.is_active,
      hasSecret: tool.has_secret,
      editingSecret: false,
      secret: "",
    });
    setFormError(null);
    setFormOpen(true);
  };

  const saveTool = async () => {
    setFormError(null);
    const name = form.name.trim();
    const slug = (form.slug.trim() || slugify(name)).toLowerCase();

    if (name.length === 0) return setFormError("Nama tool wajib diisi");
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return setFormError("Slug hanya boleh berisi huruf kecil, angka, dan tanda hubung");
    }

    setSaving(true);
    try {
      if (form.id) {
        await apiPut(`/api/tools/${form.id}`, { name, slug, is_active: form.isActive });

        if (form.editingSecret) {
          await apiPut(`/api/tools/${form.id}/secret`, {
            secret_payload: form.secret.trim().length > 0 ? form.secret : null,
          });
        }
        toast.success("Tool diperbarui");
      } else {
        await apiPost("/api/tools", {
          name,
          slug,
          is_active: form.isActive,
          secret_payload: form.secret.trim().length > 0 ? form.secret : null,
        });
        toast.success("Tool ditambahkan");
      }

      setFormOpen(false);
      await load();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Gagal menyimpan tool");
    } finally {
      setSaving(false);
    }
  };

  const deleteTool = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiDelete(`/api/tools/${deleteTarget.id}`);
      toast.success("Tool dihapus");
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus tool");
    } finally {
      setBusy(false);
    }
  };

  const toggleTool = async (tool: ToolTypeItem) => {
    try {
      await apiPut(`/api/tools/${tool.id}`, { is_active: !tool.is_active });
      toast.success(tool.is_active ? "Tool dinonaktifkan" : "Tool diaktifkan");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengubah status tool");
    }
  };

  const addVersion = async (tool: ToolTypeItem) => {
    const name = versionName.trim();
    if (name.length === 0) return toast.error("Nama version wajib diisi");

    setBusy(true);
    try {
      await apiPost(`/api/tools/${tool.id}/versions`, { name });
      toast.success(`Version ${name} ditambahkan`);
      setVersionTarget(null);
      setVersionName("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menambah version");
    } finally {
      setBusy(false);
    }
  };

  const renameVersion = async () => {
    if (!versionToEdit) return;
    const name = versionToEdit.name.trim();
    if (name.length === 0) {
      toast.error("Nama version tidak boleh kosong");
      return;
    }

    setBusy(true);
    try {
      await apiPut(`/api/tools/${versionToEdit.tool.id}/versions/${versionToEdit.versionId}`, { name });
      toast.success("Version diperbarui");
      setVersionToEdit(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengubah version");
    } finally {
      setBusy(false);
    }
  };

  const toggleVersion = async (tool: ToolTypeItem, versionId: string, isActive: boolean) => {
    try {
      await apiPut(`/api/tools/${tool.id}/versions/${versionId}`, { is_active: !isActive });
      toast.success(isActive ? "Version dinonaktifkan" : "Version diaktifkan");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengubah status version");
    }
  };

  const deleteVersion = async () => {
    if (!versionToDelete) return;
    setBusy(true);
    try {
      await apiDelete(`/api/tools/${versionToDelete.tool.id}/versions/${versionToDelete.versionId}`);
      toast.success("Version dihapus");
      setVersionToDelete(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus version");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-medium">Tool Management</h1>
          <p className="mt-1 text-body text-muted">
            Kelola tool type, version, dan payload rahasia yang dikirim saat validasi.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={openCreate} icon={<Plus size={16} strokeWidth={1.5} />}>
          Tambah Tool
        </Button>
      </header>

      {/* Public key verifikasi (read-only) */}
      <section className="card p-3">
        <div className="mb-2 flex items-center gap-2">
          <Lock size={16} strokeWidth={1.5} className="text-muted" />
          <h2 className="text-label text-muted">Public key verifikasi</h2>
        </div>
        {publicKey ? (
          <div className="flex items-start gap-2">
            <pre className="max-h-32 min-w-0 flex-1 overflow-auto rounded-control border border-border bg-bg p-2 font-mono text-[11px] leading-4 text-muted">
              {publicKey}
            </pre>
            <CopyButton value={publicKey} label="Copy public key" />
          </div>
        ) : (
          <p className="text-label text-muted">
            LICENSE_SIGNING_PUBLIC_KEY belum diisi di environment. Jalankan{" "}
            <span className="font-mono">npm run generate-keypair</span> lalu isi env-nya.
          </p>
        )}
      </section>

      {/* Tabel tool */}
      <section className="card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={5} columns={5} />
        ) : tools.length === 0 ? (
          <EmptyState
            message="Belum ada tool"
            action={
              <Button variant="primary" size="sm" onClick={openCreate}>
                Tambah Tool
              </Button>
            }
          />
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[1020px] text-body">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-label text-muted">
                  <th scope="col" className="px-3 py-2 font-normal">
                    Tool
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Slug
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Version
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Key aktif
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tools.map((tool) => {
                  const isExpanded = expanded === tool.id;
                  return (
                    <Fragment key={tool.id}>
                      <tr className="row-hover h-11">
                        <td className="px-3 py-1.5">
                          <button
                            type="button"
                            onClick={() => setExpanded(isExpanded ? null : tool.id)}
                            className="flex items-center gap-1.5 text-left transition-colors duration-150 hover:text-accent"
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? (
                              <ChevronDown size={16} strokeWidth={1.5} className="text-muted" />
                            ) : (
                              <ChevronRight size={16} strokeWidth={1.5} className="text-muted" />
                            )}
                            <span>{tool.name}</span>
                            {tool.has_secret ? (
                              <Lock size={14} strokeWidth={1.5} className="text-muted" aria-label="Punya payload rahasia" />
                            ) : null}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[13px] text-muted">{tool.slug}</td>
                        <td className="px-3 py-1.5 tabular-nums text-muted">{tool.version_count}</td>
                        <td className="px-3 py-1.5 tabular-nums text-muted">
                          {formatNumber(tool.active_keys)}
                          <span className="text-muted/70"> / {formatNumber(tool.total_keys)}</span>
                        </td>
                        <td className="px-3 py-1.5">
                          <ActiveBadge active={tool.is_active} />
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              onClick={() => setVersionTarget(tool)}
                              icon={<Plus size={14} strokeWidth={1.5} />}
                            >
                              Version
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => openEdit(tool)}
                              icon={<Pencil size={14} strokeWidth={1.5} />}
                              aria-label="Edit tool"
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => void toggleTool(tool)}
                              aria-label={tool.is_active ? "Nonaktifkan tool" : "Aktifkan tool"}
                            >
                              {tool.is_active ? "Nonaktifkan" : "Aktifkan"}
                            </Button>
                            <Button
                              size="sm"
                                                            onClick={() => setDeleteTarget(tool)}
                              icon={<Trash2 size={14} strokeWidth={1.5} />}
                              aria-label="Hapus tool"
                            >
                              Hapus
                            </Button>
                          </div>
                        </td>
                      </tr>

                      {isExpanded ? (
                        <tr className="bg-bg/40">
                          <td colSpan={6} className="px-3 py-3">
                            <div className="rounded-card border border-border bg-surface">
                              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                                <Layers size={16} strokeWidth={1.5} className="text-muted" />
                                <h3 className="text-body font-medium">Version</h3>
                                <span className="text-label text-muted tabular-nums">
                                  {tool.versions.length} version
                                </span>
                              </div>

                              {tool.versions.length === 0 ? (
                                <EmptyState
                                  message="Belum ada version"
                                  action={
                                    <Button size="sm" onClick={() => setVersionTarget(tool)}>
                                      Tambah Version
                                    </Button>
                                  }
                                />
                              ) : (
                                <ul className="divide-y divide-border">
                                  {tool.versions.map((version) => (
                                    <li key={version.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                                      <span className="min-w-[120px] flex-1 font-mono text-[13px]">
                                        {version.name}
                                      </span>
                                      <span className="text-label text-muted tabular-nums">
                                        {formatNumber(version.active_keys)} key aktif
                                      </span>
                                      <span className="text-label text-muted">
                                        Dibuat {formatDate(version.created_at)}
                                      </span>
                                      <ActiveBadge active={version.is_active} />
                                      <div className="flex items-center gap-1">
                                        <Button
                                          size="sm"
                                          onClick={() =>
                                            setVersionToEdit({
                                              tool,
                                              versionId: version.id,
                                              name: version.name,
                                            })
                                          }
                                        >
                                          Edit
                                        </Button>
                                        <Button
                                          size="sm"
                                          onClick={() => void toggleVersion(tool, version.id, version.is_active)}
                                        >
                                          {version.is_active ? "Nonaktifkan" : "Aktifkan"}
                                        </Button>
                                        <Button
                                          size="sm"
                                                                                    onClick={() =>
                                            setVersionToDelete({
                                              tool,
                                              versionId: version.id,
                                              name: version.name,
                                            })
                                          }
                                        >
                                          Hapus
                                        </Button>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-label text-muted">
        {reloading ? "Memuat ulang…" : `Total ${formatNumber(tools.length)} tool terdaftar`}
      </p>

      {/* Modal tambah/edit tool */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={form.id ? "Edit Tool" : "Tambah Tool"}
        description="Slug dipakai di sisi tool saat memanggil /api/validate."
        busy={saving}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button variant="primary" size="sm" onClick={saveTool} loading={saving}>
              Simpan
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nama tool" required>
            <Input
              value={form.name}
              onChange={(event) => {
                const name = event.target.value;
                setForm((previous) => ({
                  ...previous,
                  name,
                  slug: previous.slugTouched ? previous.slug : slugify(name),
                }));
              }}
              placeholder="Contoh: Perkakas Pro"
            />
          </Field>

          <Field label="Slug" required hint="Huruf kecil, angka, tanda hubung. Otomatis dari nama, bisa diedit.">
            <Input
              value={form.slug}
              mono
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  slug: event.target.value.toLowerCase(),
                  slugTouched: true,
                }))
              }
              placeholder="perkakas-pro"
            />
          </Field>

          <div className="flex items-center justify-between gap-3">
            <Toggle
              checked={form.isActive}
              onChange={(value) => setForm((previous) => ({ ...previous, isActive: value }))}
              label="Tool aktif"
            />
            {form.id ? (
              <span className="text-label text-muted">
                {form.hasSecret ? "Payload rahasia: Tersimpan" : "Payload rahasia: belum ada"}
              </span>
            ) : null}
          </div>

          {/* Payload rahasia: isinya tidak pernah dimuat ulang ke browser. */}
          {form.id && form.hasSecret && !form.editingSecret ? (
            <div className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface px-3 py-2">
              <span className="text-label text-muted">Payload rahasia tersimpan</span>
              <Button
                size="sm"
                onClick={() => setForm((previous) => ({ ...previous, editingSecret: true, secret: "" }))}
              >
                Ganti
              </Button>
            </div>
          ) : (
            <Field
              label={form.id && form.hasSecret ? "Payload rahasia baru" : "Payload rahasia (opsional)"}
              hint="Dikirim ke tool hanya setelah semua validasi lolos. Kosongkan untuk menghapus."
            >
              <Textarea
                value={form.secret}
                mono
                maxLength={LIMITS.secretPayloadMax}
                onChange={(event) => setForm((previous) => ({ ...previous, secret: event.target.value }))}
                placeholder='Contoh: {"kunci_dekripsi":"..."}'
              />
            </Field>
          )}

          {formError ? <p className="text-label text-banned">{formError}</p> : null}
        </div>
      </Modal>

      {/* Modal tambah version */}
      <Modal
        open={versionTarget !== null}
        onClose={() => setVersionTarget(null)}
        title="Tambah Version"
        description={versionTarget ? `Tool: ${versionTarget.name}` : undefined}
        size="sm"
        busy={busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setVersionTarget(null)} disabled={busy}>
              Batal
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => versionTarget && void addVersion(versionTarget)}
            >
              Simpan
            </Button>
          </>
        }
      >
        <Field label="Nama version" hint='Contoh: "1.8.0" atau "v2.1 Beta"'>
          <Input
            value={versionName}
            onChange={(event) => setVersionName(event.target.value)}
            placeholder="1.8.0"
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Hapus tool ini?"
        message={
          <span>
            Tool <span className="text-text">{deleteTarget?.name}</span> beserta{" "}
            {deleteTarget?.version_count ?? 0} version-nya akan dihapus. Tool yang masih punya key tidak
            bisa dihapus — hapus key-nya dulu di Key List.
          </span>
        }
        confirmLabel="Hapus tool"
        danger
        loading={busy}
        onConfirm={deleteTool}
        onClose={() => setDeleteTarget(null)}
      />

      <Modal
        open={versionToEdit !== null}
        onClose={() => setVersionToEdit(null)}
        title="Edit Version"
        description={versionToEdit ? `Tool: ${versionToEdit.tool.name}` : undefined}
        size="sm"
        busy={busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setVersionToEdit(null)} disabled={busy}>
              Batal
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={renameVersion}>
              Simpan
            </Button>
          </>
        }
      >
        <Field label="Nama version" hint="Nama ini yang harus dikirim tool pada field tool_version.">
          <Input
            value={versionToEdit?.name ?? ""}
            onChange={(event) =>
              setVersionToEdit((previous) =>
                previous ? { ...previous, name: event.target.value } : previous,
              )
            }
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={versionToDelete !== null}
        title="Hapus version ini?"
        message={
          <span>
            Version <span className="font-mono text-text">{versionToDelete?.name}</span> akan dihapus.
            Version yang masih dipakai key tidak bisa dihapus.
          </span>
        }
        confirmLabel="Hapus version"
        danger
        loading={busy}
        onConfirm={deleteVersion}
        onClose={() => setVersionToDelete(null)}
      />
    </div>
  );
}
