import {
  Check,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Pin,
  Search,
  Trash2,
} from "lucide";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MAX_MODEL_SHORTCUTS } from "@explorer-launcher/electron";
import type {
  DiskProbe,
  ModelNode,
  ModelScanReport,
} from "@explorer-launcher/electron";

import { ModelShortcuts } from "../../components/model-shortcuts";
import { Icon } from "../components/Icon";
import {
  Empty,
  Modal,
  Notice,
  PageLoading,
  Panel,
  Readout,
  Readouts,
} from "../components/ui";
import { formatBytes, formatDateTime, formatRelative } from "../lib/format";
import { useApp } from "../store";

/* ══════════════════════════════════════════════════════════
 * 模型管理
 *
 * 进入页面就扫描。结果是一棵文件夹树：点开文件夹看到里面的
 * 模型和子文件夹，再点进去是下一层。yaml 等旁路文件不出现。
 * 删除一律走系统回收站。
 * ══════════════════════════════════════════════════════════ */

/** 模型树里的相对路径 → 绝对路径（Windows 分隔符） */
const modelAbsolutePath = (modelsDir: string, relative: string): string => {
  const base = modelsDir.replace(/[\\/]+$/u, "");

  return relative ? `${base}\\${relative.replaceAll("/", "\\")}` : base;
};

export default function Models(): React.JSX.Element {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const pushToast = useApp((s) => s.pushToast);
  const root = settings?.comfyRoot;

  const [report, setReport] = useState<ModelScanReport | null>(null);
  const [probe, setProbe] = useState<DiskProbe | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [scanning, setScanning] = useState(false);
  /** 首次扫描是否已经跑完：没跑完就别渲染「没有可扫描的目录」 */
  const [scanned, setScanned] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModelNode | null>(null);
  const scanGen = useRef(0);

  const runScan = useCallback(async (): Promise<void> => {
    if (!root) {
      setScanned(true);

      return;
    }

    const gen = ++scanGen.current;
    setScanning(true);

    try {
      const next = await window.launcher.scanModels(root);

      if (gen !== scanGen.current) {
        return;
      }
      setReport(next);
    } catch (error_) {
      if (gen !== scanGen.current) return;
      pushToast(
        `扫描模型目录失败：${error_ instanceof Error ? error_.message : String(error_)}`,
        "error"
      );
    } finally {
      if (gen === scanGen.current) {
        setScanning(false);
        setScanned(true);
      }
    }
  }, [pushToast, root]);

  useEffect(() => {
    if (!root) {
      return;
    }
    void window.launcher.probeDisk().then(setProbe);
  }, [root]);

  useEffect(() => {
    void runScan();
  }, [runScan]);

  const doDelete = async (): Promise<void> => {
    const target = deleteTarget;

    if (!target || !root) {
      return;
    }
    setDeleteTarget(null);

    try {
      await window.launcher.deleteModelFile(target.relative, root);
      await runScan();
    } catch (error_) {
      pushToast(
        `删除模型失败：${error_ instanceof Error ? error_.message : String(error_)}`,
        "error"
      );
    }
  };

  const toggle = (relative: string): void => {
    setOpen((prev) => {
      const next = new Set(prev);

      if (next.has(relative)) {
        next.delete(relative);
      } else {
        next.add(relative);
      }
      return next;
    });
  };

  /** 已设为快捷的目录路径（小写，Windows 不区分大小写） */
  const shortcutPaths = useMemo(
    () =>
      new Set(
        (settings?.modelShortcuts ?? []).map((shortcut) =>
          shortcut.path.toLowerCase()
        )
      ),
    [settings]
  );

  const toggleShortcut = async (node: ModelNode): Promise<void> => {
    const modelsDir = report?.modelsDir;

    if (!modelsDir) {
      return;
    }
    const target = modelAbsolutePath(modelsDir, node.relative);
    const key = target.toLowerCase();
    const current = settings?.modelShortcuts ?? [];
    const exists = current.some(
      (shortcut) => shortcut.path.toLowerCase() === key
    );

    if (!exists && current.length >= MAX_MODEL_SHORTCUTS) {
      pushToast(`最多能放 ${MAX_MODEL_SHORTCUTS} 个快捷目录`, "warn");

      return;
    }

    try {
      await patchSettings({
        modelShortcuts: exists
          ? current.filter((shortcut) => shortcut.path.toLowerCase() !== key)
          : [...current, { path: target, name: node.name }],
      });
      pushToast(
        exists ? `已取消快捷：${node.name}` : `已设为快捷：${node.name}`
      );
    } catch (error_) {
      pushToast(
        `快捷设置失败：${error_ instanceof Error ? error_.message : String(error_)}`,
        "error"
      );
    }
  };

  const diskFree = probe?.diskFreeBytes ?? null;

  return (
    <>
      <Readouts cols={2}>
        <Readout
          label="模型总占用"
          value={report ? formatBytes(report.totalSize) : "—"}
          hint={
            report
              ? `${report.totalFiles.toLocaleString()} 个模型文件`
              : scanning
                ? "正在扫描"
                : "—"
          }
        />
        <Readout
          label={`磁盘剩余${probe?.drive ? ` ${probe.drive}` : ""}`}
          value={formatBytes(diskFree)}
          tone={
            diskFree === null
              ? "none"
              : diskFree < 20 * 1024 ** 3
                ? "error"
                : diskFree < 60 * 1024 ** 3
                  ? "warn"
                  : "ok"
          }
          hint={
            probe?.diskTotalBytes
              ? `总容量 ${formatBytes(probe.diskTotalBytes)}`
              : undefined
          }
        />
      </Readouts>

      <ModelShortcuts />

      <Panel
        fill
        flush
        title={scanning && !report ? "正在扫描模型目录" : "模型目录"}
      >
        {report ? (
          report.error ? (
            <Empty title="模型目录读取失败" hint={report.error} />
          ) : report.entries.length === 0 ? (
            <Empty
              title="模型目录是空的"
              hint="models 下面还没有文件夹或模型文件。"
            />
          ) : (
            <div className="mtree">
              <div className="mtree__head">
                <span>名称</span>
                <span>体积</span>
                <span>数量 / 时间</span>
                <span />
              </div>
              <div className="mtree__body">
                <ModelBranch
                  nodes={report.entries}
                  depth={0}
                  open={open}
                  onToggle={toggle}
                  root={root ?? ""}
                  onDelete={setDeleteTarget}
                  modelsDir={report.modelsDir}
                  shortcutKeys={shortcutPaths}
                  onToggleShortcut={(node) => {
                    void toggleShortcut(node);
                  }}
                />
              </div>
            </div>
          )
        ) : scanning || !scanned ? (
          <PageLoading label="正在扫描模型目录…" />
        ) : (
          <Empty
            title="没有可扫描的目录"
            hint="先到「设置」里指定 ComfyUI 便携版目录。"
          />
        )}
      </Panel>

      {deleteTarget && (
        <Modal
          title="删除模型文件"
          subtitle={deleteTarget.name}
          onClose={() => {
            setDeleteTarget(null);
          }}
          width={620}
          footer={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDeleteTarget(null);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void doDelete()}
              >
                移入回收站
              </button>
            </>
          }
        >
          <Notice
            tone="warn"
            title={`将释放 ${formatBytes(deleteTarget.size)} 空间`}
          >
            文件会被移入系统回收站，不是永久删除。
          </Notice>
          <div className="kv" style={{ marginTop: "var(--sp-3)" }}>
            <span className="kv__k">相对路径</span>
            <span className="kv__v">{deleteTarget.relative}</span>
            <span className="kv__k">体积</span>
            <span className="kv__v">{formatBytes(deleteTarget.size)}</span>
            <span className="kv__k">修改时间</span>
            <span className="kv__v">{formatDateTime(deleteTarget.mtime)}</span>
          </div>
        </Modal>
      )}
    </>
  );
}

function ModelBranch({
  nodes,
  depth,
  open,
  onToggle,
  root,
  onDelete,
  modelsDir,
  shortcutKeys,
  onToggleShortcut,
}: {
  nodes: ModelNode[];
  depth: number;
  open: Set<string>;
  onToggle: (relative: string) => void;
  root: string;
  onDelete: (node: ModelNode) => void;
  modelsDir: string;
  /** 已设为快捷的绝对路径（小写） */
  shortcutKeys: Set<string>;
  onToggleShortcut: (node: ModelNode) => void;
}): React.JSX.Element {
  return (
    <>
      {nodes.map((node) => {
        const expanded = node.kind === "dir" && open.has(node.relative);
        const pad = 8 + depth * 16;
        const isShortcut =
          node.kind === "dir" &&
          shortcutKeys.has(
            modelAbsolutePath(modelsDir, node.relative).toLowerCase()
          );

        return (
          <div key={node.relative || node.name}>
            <div className="mtree__row">
              {node.kind === "dir" ? (
                <button
                  type="button"
                  className="mtree__name"
                  style={{ paddingLeft: pad }}
                  onClick={() => {
                    onToggle(node.relative);
                  }}
                >
                  <span
                    className={
                      expanded ? "mtree__chev mtree__chev--open" : "mtree__chev"
                    }
                  >
                    <Icon icon={ChevronRight} size={14} />
                  </span>
                  <span className="mtree__icon">
                    <Icon icon={expanded ? FolderOpen : Folder} size={15} />
                  </span>
                  <span className="mtree__label" title={node.relative}>
                    {node.name}
                  </span>
                </button>
              ) : (
                <span
                  className="mtree__name mtree__name--file"
                  style={{ paddingLeft: pad }}
                >
                  <span className="mtree__chev" />
                  <span className="mtree__icon">
                    <Icon icon={File} size={15} />
                  </span>
                  <span className="mtree__label" title={node.relative}>
                    {node.name}
                  </span>
                </span>
              )}

              <span className="mtree__size">{formatBytes(node.size)}</span>
              <span className="mtree__meta">
                {node.kind === "dir"
                  ? `${node.fileCount.toLocaleString()} 个`
                  : formatRelative(node.mtime)}
              </span>
              <span className="mtree__actions">
                {node.kind === "dir" && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    title={isShortcut ? "从快捷访问中移除" : "添加到快捷访问"}
                    onClick={() => {
                      onToggleShortcut(node);
                    }}
                  >
                    <Icon
                      className={
                        isShortcut ? "mtree__shortcut-tick" : undefined
                      }
                      icon={isShortcut ? Check : Pin}
                      size={12}
                    />
                    {isShortcut ? "已设为快捷" : "设为快捷"}
                  </button>
                )}
                {node.kind === "file" && (
                  <>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() =>
                        void window.launcher.revealModelFile(
                          node.relative,
                          root
                        )
                      }
                    >
                      <Icon icon={Search} size={12} />
                      定位
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--danger"
                      onClick={() => {
                        onDelete(node);
                      }}
                    >
                      <Icon icon={Trash2} size={12} />
                    </button>
                  </>
                )}
              </span>
            </div>

            {expanded &&
              (node.children.length === 0 ? (
                <div className="mtree__empty" style={{ paddingLeft: pad + 18 }}>
                  这个文件夹里没有模型
                </div>
              ) : (
                <ModelBranch
                  nodes={node.children}
                  depth={depth + 1}
                  open={open}
                  onToggle={onToggle}
                  root={root}
                  onDelete={onDelete}
                  modelsDir={modelsDir}
                  shortcutKeys={shortcutKeys}
                  onToggleShortcut={onToggleShortcut}
                />
              ))}
          </div>
        );
      })}
    </>
  );
}
