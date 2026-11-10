import { Trash2 } from "lucide";
import { useState } from "react";

import { Icon } from "../components/Icon";
import { Empty, Panel, Segmented, Tag, Terminal } from "../components/ui";
import { formatServiceState } from "../lib/format";
import { useApp } from "../store";

/* ══════════════════════════════════════════════════════════
 * 日志中心
 *
 * 两条独立日志流：
 *   运行日志   = ComfyUI 进程的 stdout/stderr
 *   启动器日志 = 主进程自己的记录（环境探测、插件/版本任务）
 * 两个页签各自滚动、各自清空，不再把操作日志混进运行时输出里。
 * ══════════════════════════════════════════════════════════ */

type LogTab = "runtime" | "launcher";

export default function Logs(): React.JSX.Element {
  const logs = useApp((s) => s.logs);
  const launcherLogs = useApp((s) => s.launcherLogs);
  const clearLogs = useApp((s) => s.clearLogs);
  const clearLauncherLogs = useApp((s) => s.clearLauncherLogs);
  const service = useApp((s) => s.service);
  const [tab, setTab] = useState<LogTab>("runtime");

  const activeLogs = tab === "runtime" ? logs : launcherLogs;
  const clearActive = tab === "runtime" ? clearLogs : clearLauncherLogs;

  return (
    <Panel
      fill
      flush
      title={
        <Segmented<LogTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "runtime", label: "运行日志" },
            { value: "launcher", label: "启动器日志" },
          ]}
        />
      }
      actions={
        <>
          <Tag tone={service?.state === "running" ? "ok" : "none"}>
            {formatServiceState(service?.state)}
          </Tag>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void clearActive()}
          >
            <Icon icon={Trash2} size={13} />
            清空
          </button>
        </>
      }
    >
      <div style={{ padding: "var(--sp-2)" }}>
        {activeLogs.length === 0 ? (
          <Empty
            title="暂无日志"
            hint={
              tab === "runtime"
                ? "启动 ComfyUI 后，它的进程输出会实时显示在这里。"
                : "环境探测、插件安装/更新、版本切换等启动器操作会记录在这里。"
            }
          />
        ) : (
          <Terminal lines={activeLogs} />
        )}
      </div>
    </Panel>
  );
}
