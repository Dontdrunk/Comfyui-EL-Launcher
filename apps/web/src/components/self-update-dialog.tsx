import { ArrowRight, Download, RefreshCw } from "lucide";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { SelfUpdateStatus } from "@explorer-launcher/electron";

import { Icon } from "../launcher/components/Icon";
import { Led, Modal, Spinner } from "../launcher/components/ui";
import { formatBytes, formatDateTime } from "../launcher/lib/format";

import "./self-update-dialog.css";

/* ══════════════════════════════════════════════════════════
 * 自更新弹窗
 *
 * 只在「更新前」出现：版本比对 + 更新说明 + 两个按钮。
 * 点下「立即更新并重启」后主窗口会收起，下载/校验/安装交给
 * 独立的进度窗口（update.html），这里不再展示任何进度。
 * ══════════════════════════════════════════════════════════ */

const titleOf = (
  status: SelfUpdateStatus | null,
  checking: boolean
): string => {
  if (checking) {
    return "正在检查更新";
  }

  if (status?.state === "latest") {
    return "已是最新版本";
  }

  if (status?.state === "available") {
    return "发现新版本";
  }

  if (status?.state === "error") {
    return "检查更新失败";
  }

  return "更新启动器";
};

const factsOf = (status: SelfUpdateStatus | null): string[] => {
  if (!status) {
    return [];
  }

  const parts: string[] = [];

  if (status.size !== null) {
    parts.push(formatBytes(status.size));
  }

  parts.push(status.portable ? "便携版" : "安装版");

  if (status.publishedAt !== null) {
    parts.push(formatDateTime(status.publishedAt).slice(0, 10));
  }

  return parts;
};

const notesPlaceholderOf = (
  status: SelfUpdateStatus | null,
  checking: boolean
): string => {
  if (checking) {
    return "正在获取更新信息…";
  }

  if (status?.state === "latest") {
    return "已经是最新版本，没有需要安装的内容。";
  }

  if (status?.state === "available") {
    return "这个版本没有填写更新说明。";
  }

  return "更新信息不可用。";
};

const Transit = ({
  status,
}: {
  status: SelfUpdateStatus | null;
}): React.JSX.Element => {
  const current = status?.currentVersion ?? "…";
  const next = status?.version ?? null;

  return (
    <div className="update__transit">
      <div className="update__version">
        <span className="update__label">当前安装</span>
        <span className="update__num mono">v{current}</span>
      </div>
      <div className="update__connector">
        <span className="update__connector-line" />
        <Icon icon={ArrowRight} size={14} />
      </div>
      <div className="update__version update__version--next">
        <span className="update__label">可更新</span>
        <span className="update__num mono">
          {next === null ? "—" : `v${next}`}
        </span>
      </div>
    </div>
  );
};

const Facts = ({
  status,
}: {
  status: SelfUpdateStatus | null;
}): React.JSX.Element | null => {
  const facts = factsOf(status);
  const releaseUrl = status?.releaseUrl ?? null;

  if (facts.length === 0 && releaseUrl === null) {
    return null;
  }

  return (
    <div className="update__facts">
      <span className="update__fact">{facts.join(" · ")}</span>
      {releaseUrl === null ? null : (
        <a
          className="update__link"
          href={releaseUrl}
          target="_blank"
          rel="noreferrer"
        >
          在 GitHub 查看
        </a>
      )}
    </div>
  );
};

const Notes = ({
  status,
  checking,
}: {
  status: SelfUpdateStatus | null;
  checking: boolean;
}): React.JSX.Element => {
  const raw = status?.notes ?? null;
  const notes = raw !== null && raw.trim().length > 0 ? raw : null;

  return (
    <section className="update__notes">
      {notes === null ? (
        <div className="update__empty">
          {notesPlaceholderOf(status, checking)}
        </div>
      ) : (
        <div className="update__notes-body">
          <Markdown remarkPlugins={[remarkGfm]}>{notes}</Markdown>
        </div>
      )}
    </section>
  );
};

interface SelfUpdateDialogProps {
  status: SelfUpdateStatus | null;
  error: string | null;
  checking: boolean;
  onClose: () => void;
  onStart: () => void;
  onRetry: () => void;
}

const DialogFooter = ({
  status,
  error,
  checking,
  onClose,
  onStart,
  onRetry,
}: SelfUpdateDialogProps): React.JSX.Element => (
  <>
    <button type="button" className="btn" onClick={onClose}>
      关闭
    </button>
    {error === null ? null : (
      <button type="button" className="btn" onClick={onRetry}>
        <Icon icon={RefreshCw} size={14} />
        重试
      </button>
    )}
    {status?.state === "available" && error === null ? (
      <button
        type="button"
        className="btn btn--primary"
        disabled={!status.packaged || checking}
        onClick={onStart}
        title={status.packaged ? undefined : "开发模式不会替换当前进程"}
      >
        {checking ? <Spinner /> : <Icon icon={Download} size={14} />}
        立即更新并重启
      </button>
    ) : null}
  </>
);

const SelfUpdateDialog = ({
  status,
  error,
  checking,
  onClose,
  onStart,
  onRetry,
}: SelfUpdateDialogProps): React.JSX.Element => {
  const latest = status?.state === "latest";

  return (
    <Modal
      title={titleOf(status, checking)}
      width={640}
      onClose={onClose}
      footer={
        <DialogFooter
          status={status}
          error={error}
          checking={checking}
          onClose={onClose}
          onStart={onStart}
          onRetry={onRetry}
        />
      }
    >
      <div className="update">
        {latest ? (
          <div className="update__latest">
            <Led
              tone="ok"
              label={`v${status?.version ?? status?.currentVersion ?? ""} · 无需更新`}
            />
          </div>
        ) : (
          <>
            <Transit status={status} />
            <Facts status={status} />
          </>
        )}

        {status?.packaged === false ? (
          <div className="update__hint">
            <Led tone="warn" label="开发模式：这里不会替换当前进程" />
          </div>
        ) : null}

        {error === null ? null : (
          <div className="update__error">
            <Led tone="error" label="更新没有完成" />
            <p className="update__error-msg">{error}</p>
          </div>
        )}

        <Notes status={status} checking={checking} />
      </div>
    </Modal>
  );
};

/* ── 弹窗状态机 ── */

interface SelfUpdateFlow {
  status: SelfUpdateStatus | null;
  open: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  dialog: ReactNode;
}

const toMessage = (error: Error): string =>
  // IPC 拒绝会把 "Error invoking remote method 'x':" 前缀带进来
  error.message.replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/u,
    ""
  );

export const useSelfUpdate = (): SelfUpdateFlow => {
  const [status, setStatus] = useState<SelfUpdateStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setChecking(true);
    setError(null);

    try {
      const next = await window.launcher.selfUpdateStatus();

      setStatus(next);

      if (next.state === "error") {
        setError(next.message);
      }
    } catch (error_) {
      setError(error_ instanceof Error ? toMessage(error_) : "检查更新失败");
    }

    // 不使用 finally：React Compiler 目前不支持 try/finally
    setChecking(false);
  }, []);

  // 首帧之后再检查：让总览页先画出来，避免挂载时同步 setState
  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh();
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [refresh]);

  const openDialog = useCallback((): void => {
    setOpen(true);
    setError(null);
    void refresh();
  }, [refresh]);

  const closeDialog = useCallback((): void => {
    setOpen(false);
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (status?.packaged !== true) {
      return;
    }

    // 主窗口马上会被进度窗口替换，先把确认框收掉
    setOpen(false);
    setError(null);

    try {
      await window.launcher.selfUpdateInstall();
    } catch (installError) {
      setError(
        installError instanceof Error ? toMessage(installError) : "更新失败"
      );
      setOpen(true);
    }
  }, [status]);

  const retry = useCallback((): void => {
    if (status?.state === "available" && status.packaged) {
      void start();
    } else {
      void refresh();
    }
  }, [refresh, start, status]);

  const dialog = open ? (
    <SelfUpdateDialog
      status={status}
      error={error}
      checking={checking}
      onClose={closeDialog}
      onStart={() => {
        void start();
      }}
      onRetry={retry}
    />
  ) : null;

  return { status, open, openDialog, closeDialog, dialog };
};
