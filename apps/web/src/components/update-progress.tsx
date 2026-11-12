import { useCallback, useEffect, useState } from "react";

import type { SelfUpdateProgress } from "@explorer-launcher/electron";

import { formatBytes } from "../launcher/lib/format";

import "./update-progress.css";

/* ══════════════════════════════════════════════════════════
 * 自更新进度窗口
 *
 * 主窗口这时已经藏起来，这里只剩一件事：让用户看见「在下载什么、
 * 到哪一步了」。窗口无边框，顶部一条拖拽区；失败时给一个回主界面的出口。
 * ══════════════════════════════════════════════════════════ */

const STAGE_LABELS = {
  idle: "准备更新…",
  checking: "正在检查更新",
  downloading: "正在下载安装包",
  verifying: "正在校验更新包",
  installing: "正在安装更新",
  error: "更新没有完成",
} as const;

const versionOf = (key: string): string | null =>
  new URLSearchParams(window.location.search).get(key);

const formatEta = (progress: SelfUpdateProgress): string | null => {
  const { bytesPerSecond, receivedBytes, totalBytes } = progress;

  if (totalBytes === null || bytesPerSecond === null || bytesPerSecond <= 0) {
    return null;
  }

  const seconds = Math.max(
    1,
    Math.round((totalBytes - receivedBytes) / bytesPerSecond)
  );

  if (seconds < 60) {
    return `剩 ${seconds} 秒`;
  }

  return `剩 ${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
};

const Head = ({
  from,
  to,
}: {
  from: string | null;
  to: string | null;
}): React.JSX.Element => (
  <header className="upd__head">
    <span className="upd__title">更新启动器</span>
    {from === null || to === null ? null : (
      <span className="upd__versions">
        v{from} → v{to}
      </span>
    )}
  </header>
);

const DownloadStats = ({
  progress,
}: {
  progress: SelfUpdateProgress | null;
}): React.JSX.Element => {
  const percent = progress?.percent ?? null;
  const received = progress?.receivedBytes ?? 0;
  const total = progress?.totalBytes ?? null;
  const speed = progress?.bytesPerSecond ?? null;
  const eta = progress ? formatEta(progress) : null;

  return (
    <div className="upd__stats">
      <span className="upd__percent mono">
        {percent === null ? "—" : `${percent}%`}
      </span>
      <span>
        {total === null
          ? `已下载 ${formatBytes(received)}`
          : `${formatBytes(received)} / ${formatBytes(total)}`}
      </span>
      {speed === null ? null : <span>{formatBytes(speed)}/s</span>}
      {eta === null ? null : <span>{eta}</span>}
    </div>
  );
};

const Meter = ({
  progress,
}: {
  progress: SelfUpdateProgress | null;
}): React.JSX.Element => {
  const stage = progress?.stage ?? "idle";
  const indeterminate = stage === "idle" || stage === "verifying";
  const percent = stage === "installing" ? 100 : (progress?.percent ?? null);

  const message =
    stage === "verifying"
      ? "下载完成，正在校验文件完整性…"
      : (progress?.message ?? "准备下载…");

  return (
    <>
      <div className="upd__track">
        <div
          className="upd__fill"
          data-indeterminate={indeterminate ? "true" : "false"}
          style={indeterminate ? undefined : { width: `${percent ?? 0}%` }}
        />
      </div>
      {stage === "downloading" ? (
        <DownloadStats progress={progress} />
      ) : (
        <div className="upd__stats">
          <span>{message}</span>
        </div>
      )}
    </>
  );
};

const Actions = ({
  stage,
  cancelling,
  onCancel,
  onDismiss,
}: {
  stage: SelfUpdateProgress["stage"] | "idle";
  cancelling: boolean;
  onCancel: () => void;
  onDismiss: () => void;
}): React.JSX.Element => {
  if (stage === "downloading") {
    return (
      <footer className="upd__foot">
        <button
          type="button"
          className="btn btn--sm"
          disabled={cancelling}
          onClick={onCancel}
        >
          {cancelling ? "正在取消…" : "取消下载"}
        </button>
      </footer>
    );
  }

  if (stage === "error") {
    return (
      <footer className="upd__foot">
        <button type="button" className="btn btn--sm" onClick={onDismiss}>
          返回启动器
        </button>
      </footer>
    );
  }

  return <footer className="upd__foot" />;
};

export const UpdateProgressPage = (): React.JSX.Element => {
  const [progress, setProgress] = useState<SelfUpdateProgress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const from = versionOf("from");
  const to = versionOf("to");

  useEffect(() => {
    const off = window.launcher.onSelfUpdate((next) => {
      setProgress(next);
    });

    // 告诉主进程页面已就绪，可以开始下载了（否则会错过第一批进度事件）
    window.launcher.selfUpdateUiReady();

    return off;
  }, []);

  const cancel = useCallback((): void => {
    setCancelling(true);
    void window.launcher.selfUpdateCancel();
  }, []);

  const dismiss = useCallback((): void => {
    void window.launcher.selfUpdateDismiss();
  }, []);

  const stage = progress?.stage ?? "idle";

  return (
    <div className="upd">
      <Head from={from} to={to} />
      <div className="upd__body">
        <div className="upd__stage">{STAGE_LABELS[stage]}</div>
        {stage === "error" ? (
          <p className="upd__error">{progress?.message ?? "更新没有完成"}</p>
        ) : (
          <Meter progress={progress} />
        )}
      </div>
      <Actions
        stage={stage}
        cancelling={cancelling}
        onCancel={cancel}
        onDismiss={dismiss}
      />
    </div>
  );
};
