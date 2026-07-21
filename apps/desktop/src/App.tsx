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

export default function App() {
  const phase = useStudio((s) => s.phase);
  const selection = useStudio((s) => s.selection);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const isDatabase = useStudio((s) => {
    if (!s.selection) return false;
    const provider = s.providers.find((p) => p.providerId === s.selection?.providerId);
    return provider?.capabilities.includes("database.query") ?? false;
  });

  useEffect(() => {
    connect();
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Header />
      {phase === "connected" ? (
        <>
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="relative flex min-w-0 flex-1 overflow-hidden">
              {isDatabase ? (
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
          <ActivityStrip />
          <GlobalSearch />
        </>
      ) : (
        <main className="min-h-0 flex-1">
          <WaitingScreen />
        </main>
      )}
    </div>
  );
}
