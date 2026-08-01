import { useEffect, useState } from "react";
import { useStudio } from "./lib/store.ts";
import { connect } from "./lib/studio-client.ts";
import { Header } from "./components/Header.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { WaitingScreen } from "./components/WaitingScreen.tsx";
import { KeyList } from "./components/KeyList.tsx";
import { ValueEditor } from "./components/ValueEditor.tsx";
import { TableList } from "./components/TableList.tsx";
import { RowGrid } from "./components/RowGrid.tsx";
import { ActivityStrip } from "./components/ActivityStrip.tsx";
import { GlobalSearch } from "./components/GlobalSearch.tsx";
import { StorageOverview } from "./components/StorageOverview.tsx";
import { NetworkView } from "./components/network/NetworkView.tsx";
import { LogsView } from "./components/logs/LogsView.tsx";
import { TimelineView } from "./components/timeline/TimelineView.tsx";

export default function App() {
  const phase = useStudio((s) => s.phase);
  const activeModule = useStudio((s) => s.activeModule);
  const selection = useStudio((s) => s.selection);
  const selectedDeviceId = useStudio((s) => s.selectedDeviceId);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const isDatabase = useStudio((s) => {
    if (!s.selection) return false;
    const provider = s.providers.find((p) => p.providerId === s.selection?.providerId);
    return provider?.capabilities.includes("database.query") ?? false;
  });

  useEffect(() => {
    connect();
  }, []);

  // Trocar de device fecha a visão geral — ela pertence ao device anterior.
  useEffect(() => {
    setOverviewOpen(false);
  }, [selectedDeviceId]);

  return (
    <div className="flex h-full flex-col">
      <Header />
      {phase === "connected" ? (
        <>
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="relative flex min-w-0 flex-1 overflow-hidden">
              {activeModule === "network" ? (
                <NetworkView />
              ) : activeModule === "logs" ? (
                <LogsView />
              ) : activeModule === "timeline" ? (
                <TimelineView />
              ) : isDatabase ? (
                <>
                  <TableList />
                  <RowGrid />
                </>
              ) : (
                <>
                  <KeyList onOpenOverview={() => setOverviewOpen(true)} />
                  <ValueEditor />
                  <StorageOverview
                    open={overviewOpen}
                    selection={selection}
                    onClose={() => setOverviewOpen(false)}
                  />
                </>
              )}
            </main>
          </div>
          {activeModule === "storage" && <ActivityStrip />}
          {activeModule === "storage" && <GlobalSearch />}
        </>
      ) : (
        <main className="min-h-0 flex-1">
          <WaitingScreen />
        </main>
      )}
    </div>
  );
}
