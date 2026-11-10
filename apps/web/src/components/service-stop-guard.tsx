import { Square } from "lucide";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import { Icon } from "../launcher/components/Icon";
import { Modal, Notice, Spinner } from "../launcher/components/ui";
import { useApp } from "../launcher/store";

/**
 * 「写操作前先停服」的唯一入口。
 *
 * 服务没在跑就直接执行；跑着就先弹一次确认，确认后结束 ComfyUI 进程再执行。
 * 主进程对这些写操作另有硬性拦截，这里只是把「先停服」挪到用户点下去的那一刻，
 * 页面顶部不再常驻一条「请先去停止」的横幅。
 */
interface PendingAction {
  /** 出现在弹窗里的动作名，例如「切换版本」 */
  action: string;
  run: () => Promise<void> | void;
}

export interface ServiceStopGuard {
  /** 需要停服的写操作走这里；服务没运行时会立刻执行 */
  proceed: (action: string, run: () => Promise<void> | void) => void;
  /** 挂到页面根节点上；没有待确认的操作时是 null */
  dialog: ReactNode;
}

export const useServiceStopGuard = (): ServiceStopGuard => {
  const service = useApp((s) => s.service);
  const stopService = useApp((s) => s.stopService);
  const pushToast = useApp((s) => s.pushToast);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running =
    service?.state === "running" || service?.state === "launching";

  const proceed = useCallback(
    (action: string, run: () => Promise<void> | void): void => {
      if (!running) {
        void run();

        return;
      }

      setError(null);
      setPending({ action, run });
    },
    [running]
  );

  const close = useCallback((): void => {
    setPending(null);
    setError(null);
  }, []);

  const confirm = useCallback(async (): Promise<void> => {
    if (!pending || stopping) {
      return;
    }

    setStopping(true);
    setError(null);

    try {
      await stopService();
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_));
      setStopping(false);

      return;
    }

    /* 主进程 stop() 走完状态就是 stopped；还停在运行态说明进程没退干净 */
    const state = useApp.getState().service?.state;

    if (state === "running" || state === "launching") {
      setError("ComfyUI 没有停下，请到总览页手动停止后重试。");
      setStopping(false);

      return;
    }

    setPending(null);
    setStopping(false);

    try {
      await pending.run();
    } catch (error_) {
      pushToast(
        `操作失败：${error_ instanceof Error ? error_.message : String(error_)}`,
        "error"
      );
    }
  }, [pending, stopping, stopService, pushToast]);

  const dialog = pending ? (
    <Modal
      title="ComfyUI 正在运行"
      subtitle={pending.action}
      width={560}
      onClose={() => {
        if (!stopping) {
          close();
        }
      }}
      footer={
        <>
          <button
            type="button"
            className="btn"
            disabled={stopping}
            onClick={close}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={stopping}
            onClick={() => {
              void confirm();
            }}
          >
            {stopping ? <Spinner /> : <Icon icon={Square} size={13} />}
            停止并继续
          </button>
        </>
      }
    >
      <Notice tone="warn" title={`${pending.action}需要先停止 ComfyUI`}>
        继续会先结束正在运行的 ComfyUI
        终端，再执行这一步。正在跑的生成任务会中断。
      </Notice>
      {error !== null && (
        <Notice tone="error" title="停止失败">
          {error}
        </Notice>
      )}
    </Modal>
  ) : null;

  return { dialog, proceed };
};
