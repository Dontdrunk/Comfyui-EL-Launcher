import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, Folder, Play, Square } from "lucide";
import { useEffect, useMemo, useState } from "react";

import { launchCommand } from "@explorer-launcher/electron";
import type {
  LaunchDefaults,
  SelfUpdateStatus,
} from "@explorer-launcher/electron";

import { BannerBackdrop } from "../components/BannerBackdrop";
import { Icon } from "../components/Icon";
import {
  Empty,
  Modal,
  Notice,
  Panel,
  Progress,
  Readout,
  Readouts,
} from "../components/ui";
import { APP_VERSION } from "../lib/appVersion";
import { useApp } from "../store";

/* ══════════════════════════════════════════════════════════
 * 总览与启动
 *
 * 这一页同时承担「启动器基本盘」与「后续功能的验证工具」两个角色：
 * 版本切换、插件安装之后都要靠它把 ComfyUI 拉起来验证结果。
 * ══════════════════════════════════════════════════════════ */

export default function Dashboard(): React.JSX.Element {
  const navigate = useNavigate();
  const settings = useApp((s) => s.settings);
  const env = useApp((s) => s.env);
  const envLoading = useApp((s) => s.envLoading);
  const runtime = useApp((s) => s.runtime);
  const runtimeLoading = useApp((s) => s.runtimeLoading);
  const service = useApp((s) => s.service);
  const patchSettings = useApp((s) => s.patchSettings);
  const startService = useApp((s) => s.startService);
  const stopService = useApp((s) => s.stopService);
  const pushToast = useApp((s) => s.pushToast);

  const [form, setForm] = useState<LaunchDefaults | null>(
    settings?.launch ?? null
  );

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selfUpdate, setSelfUpdate] = useState<SelfUpdateStatus | null>(null);
  const [updatePercent, setUpdatePercent] = useState<number | null>(null);
  const [killConfirm, setKillConfirm] = useState(false);
  const [killing, setKilling] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm(settings.launch);
    }
  }, [settings]);

  useEffect(() => {
    let alive = true;
    void window.launcher.selfUpdateStatus().then((status) => {
      if (alive) {
        setSelfUpdate(status);
      }
    });

    const off = window.launcher.onSelfUpdate((progress) => {
      if (alive) {
        setUpdatePercent(progress.percent);
      }
    });

    return () => {
      alive = false;
      off();
    };
  }, []);

  const onSelfUpdate = (): void => {
    if (!selfUpdate?.packaged) {
      pushToast("开发模式不会替换当前进程", "warn");

      return;
    }

    setUpdatePercent(0);
    void window.launcher.selfUpdateInstall().catch((error: unknown) => {
      setUpdatePercent(null);
      const raw = error instanceof Error ? error.message : String(error);

      const message = raw.replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        ""
      );

      pushToast(message, "error");
    });
  };

  const state = service?.state ?? "stopped";
  const isActive = state === "running" || state === "launching";
  const isBusy = state === "launching" || state === "stopping";

  /* 主按钮形态在顶层算好，避免在 JSX 分支里对已被收窄的 state 再次比较 */
  const primaryAction: "start" | "stop" | "stopping" =
    state === "stopping" ? "stopping" : isActive ? "stop" : "start";

  const onStart = async (): Promise<void> => {
    if (!form) {
      return;
    }
    setBusy(true);
    setActionError(null);

    try {
      // 用当前表单值启动，保证「改了没保存」也能立刻生效
      await patchSettings({ launch: form });
      await startService(form);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  /** 端口被别人占着：确认后结束它，再正常启动 */
  const onReclaim = async (): Promise<void> => {
    setKilling(true);
    setActionError(null);

    try {
      await window.launcher.killPortOwner();
      setKillConfirm(false);
      await onStart();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setKilling(false);
    }
  };

  const onStop = async (): Promise<void> => {
    setBusy(true);
    setActionError(null);

    try {
      await stopService();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const commandLine = useMemo(() => {
    if (!form) {
      return "";
    }
    const python =
      env?.pythonExe ||
      (settings?.comfyRoot
        ? `${settings.comfyRoot}\\python_embeded\\python.exe`
        : "");

    return launchCommand(python, form);
  }, [form, env?.pythonExe, settings?.comfyRoot]);

  const envIssues = useMemo(() => env?.issues ?? [], [env]);
  const errors = envIssues.filter((i) => i.level === "error");
  const warnings = envIssues.filter((i) => i.level === "warn");

  return (
    <>
      {/* ── 横幅背景板：双击换下一套 ── */}
      <BannerBackdrop height={200} />

      {/* ── 环境问题 ── */}
      {errors.map((issue, i) => (
        <Notice key={`e${i}`} tone="error" title={issue.message}>
          {issue.hint}
        </Notice>
      ))}
      {warnings.map((issue, i) => (
        <Notice key={`w${i}`} tone="warn" title={issue.message}>
          {issue.hint}
        </Notice>
      ))}
      {errors.length > 0 && <div style={{ height: "var(--sp-4)" }} />}

      {/* ── 环境读数 ── */}
      <Readouts cols={3}>
        <Readout
          label="ComfyUI 版本"
          value={env?.appVersion ?? "—"}
          hint={env?.isGitRepo ? "git 仓库" : "非 git 仓库"}
          mono
          tone={env?.valid ? "none" : "error"}
        />
        <Readout
          label="Python"
          value={runtimeLoading ? "…" : (runtime?.pythonVersion ?? "—")}
          hint="python_embeded"
        />
        <Readout
          label="PyTorch"
          value={runtimeLoading ? "…" : (runtime?.torchVersion ?? "—")}
          hint={runtime?.cudaVersion ? `CUDA ${runtime.cudaVersion}` : "未探测"}
        />
        <Readout
          label="GPU"
          value={runtimeLoading ? "…" : (runtime?.gpuName ?? "—")}
          hint={
            runtime?.cudaAvailable
              ? `CUDA 可用 · ${runtime.deviceCount} 个设备`
              : runtime?.probed
                ? "CUDA 不可用"
                : "未探测"
          }
          small
          tone={
            runtime?.probed ? (runtime.cudaAvailable ? "ok" : "error") : "none"
          }
        />
        <Readout
          label="服务端口"
          value={String(form?.port ?? 8188)}
          hint={
            service?.external ? "接管中" : service?.ready ? "已监听" : "未监听"
          }
          mono
          tone={service?.external ? "warn" : service?.ready ? "ok" : "none"}
        />
        <Readout
          label="软件版本"
          value={`v${APP_VERSION}`}
          hint={versionHint(selfUpdate, updatePercent, onSelfUpdate)}
          mono
        />
      </Readouts>

      <Panel title="进程操作">
        {actionError && (
          <div style={{ marginBottom: "var(--sp-3)" }}>
            <Notice tone="error" title="操作失败">
              {actionError}
            </Notice>
          </div>
        )}
        {/* 端口被占：说清是谁占着，并给出两个可点的动作（接管成功时不算冲突） */}
        {service?.portOwner && state === "error" && (
          <div style={{ marginBottom: "var(--sp-3)" }}>
            <Notice tone="error" title="端口被占用">
              {service.lastError}
            </Notice>
            <div className="actionbar" style={{ marginTop: "var(--sp-2)" }}>
              {service.portLive && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() =>
                    void window.launcher.openExternal(
                      `http://127.0.0.1:${service.port}`
                    )
                  }
                >
                  <Icon icon={ExternalLink} size={15} />
                  打开现有服务
                </button>
              )}
              <button
                type="button"
                className="btn btn--sm btn--danger"
                disabled={busy || killing}
                onClick={() => {
                  setKillConfirm(true);
                }}
              >
                结束占用进程并启动
              </button>
            </div>
          </div>
        )}

        {service?.lastError &&
          !actionError &&
          (!service?.portOwner || state !== "error") && (
            <div style={{ marginBottom: "var(--sp-3)" }}>
              <Notice tone="error" title="服务异常">
                {service.lastError}
              </Notice>
            </div>
          )}

        {service?.external && (
          <div style={{ marginBottom: "var(--sp-3)" }}>
            <Notice tone="info" title="已接管正在运行的 ComfyUI">
              这是上次启动器异常退出时留下的进程（PID {service.pid}
              ），现在由启动器接管： 点下面的「停止
              ComfyUI」可以直接结束它；退出启动器不会动它。
            </Notice>
          </div>
        )}

        <div className="stack">
          <div className="actionbar">
            <button
              type="button"
              className="btn"
              disabled={!service?.ready || !service.url}
              onClick={() =>
                service?.url && void window.launcher.openExternal(service.url)
              }
            >
              <Icon icon={ExternalLink} size={16} />
              打开界面
            </button>
            <button
              type="button"
              className="btn"
              disabled={!env?.root}
              onClick={() =>
                env?.root && void window.launcher.openPath(env.root)
              }
            >
              <Icon icon={Folder} size={16} />
              根目录
            </button>
            <button
              type="button"
              className="btn"
              disabled={!env?.customNodesDir}
              onClick={() =>
                env?.customNodesDir &&
                void window.launcher.openPath(env.customNodesDir)
              }
            >
              <Icon icon={Folder} size={16} />
              插件目录
            </button>
            <button
              type="button"
              className="btn"
              disabled={!env?.outputDir}
              onClick={() =>
                env?.outputDir && void window.launcher.openPath(env.outputDir)
              }
            >
              <Icon icon={Folder} size={16} />
              输出目录
            </button>
          </div>

          {isBusy && <Progress percent={null} />}

          {(() => {
            const starting = primaryAction === "start";

            return (
              <button
                type="button"
                className={`btn btn--lg btn--block ${starting ? "btn--primary" : "btn--stop"}`}
                onClick={() => void (starting ? onStart() : onStop())}
                disabled={
                  starting
                    ? busy || !env?.valid
                    : busy || primaryAction === "stopping"
                }
              >
                <Icon icon={starting ? Play : Square} size={15} />
                {starting
                  ? "启动 ComfyUI"
                  : primaryAction === "stopping"
                    ? "正在停止…"
                    : "停止 ComfyUI"}
              </button>
            );
          })()}

          <div className="field" style={{ marginBottom: 0 }}>
            <span className="field__label">实际命令行</span>
            <div
              className="mono"
              style={{
                fontSize: "var(--fs-xs)",
                color: "var(--fg-muted)",
                background: "var(--bg-sunken)",
                border: "1px solid var(--stroke)",
                borderRadius: "var(--r-sm)",
                padding: "6px 9px",
                wordBreak: "break-all",
                userSelect: "text",
              }}
            >
              {commandLine || "—"}
            </div>
          </div>
        </div>
      </Panel>

      {/* ══════════ 结束占用进程确认 ══════════ */}
      {killConfirm && service?.portOwner && state === "error" && (
        <Modal
          title="结束占用端口的进程"
          subtitle={`${service.portOwner.name} · PID ${service.portOwner.pid}`}
          onClose={() => {
            setKillConfirm(false);
          }}
          width={640}
          footer={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setKillConfirm(false);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={killing}
                onClick={() => void onReclaim()}
              >
                {killing ? "正在结束…" : "结束并启动"}
              </button>
            </>
          }
        >
          <Notice tone="warn" title="会强制结束该进程及其子进程">
            结束后启动器会立刻用当前设置重新启动
            ComfyUI。如果它其实是被别的程序占用的端口， 请先确认那是什么进程。
          </Notice>
          <div className="kv" style={{ marginTop: "var(--sp-3)" }}>
            <span className="kv__k">进程</span>
            <span className="kv__v">{service.portOwner.name}</span>
            <span className="kv__k">PID</span>
            <span className="kv__v">{service.portOwner.pid}</span>
            <span className="kv__k">端口</span>
            <span className="kv__v">{service.port}</span>
          </div>
          {service.portOwner.commandLine && (
            <div style={{ marginTop: "var(--sp-3)" }}>
              <span className="field__label">命令行</span>
              <div
                className="mono"
                style={{ fontSize: "var(--fs-xs)", wordBreak: "break-all" }}
              >
                {service.portOwner.commandLine}
              </div>
            </div>
          )}
        </Modal>
      )}

      {!env?.valid && !envLoading && (
        <>
          <div className="section-title">诊断</div>
          <Panel title="目录结构">
            <Empty
              title="当前目录不是有效的 ComfyUI 便携版"
              hint="需要同时包含 python_embeded\python.exe 与 ComfyUI\main.py。"
              actions={
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => void navigate({ to: "/settings" })}
                >
                  前往设置
                </button>
              }
            />
          </Panel>
        </>
      )}
    </>
  );
}

function versionHint(
  status: SelfUpdateStatus | null,
  percent: number | null,
  onUpdate: () => void
): React.ReactNode {
  if (percent !== null) {
    return (
      <button type="button" className="readout__link" disabled>
        {percent}%
      </button>
    );
  }

  if (!status) {
    return "…";
  }
  if (status.state === "available") {
    return (
      <button type="button" className="readout__link" onClick={onUpdate}>
        更新
      </button>
    );
  }

  if (status.state === "latest") {
    return "最新";
  }
  return <span title={status.message ?? undefined}>—</span>;
}
