import { useEffect } from "react";
import { useStudio } from "./lib/store.ts";
import { connect } from "./lib/studio-client.ts";
import { Header } from "./components/Header.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { WaitingScreen } from "./components/WaitingScreen.tsx";
import { KeyList } from "./components/KeyList.tsx";
import { ValueEditor } from "./components/ValueEditor.tsx";
import { ActivityStrip } from "./components/ActivityStrip.tsx";

export default function App() {
  const phase = useStudio((s) => s.phase);

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
            <main className="flex min-w-0 flex-1">
              <KeyList />
              <ValueEditor />
            </main>
          </div>
          <ActivityStrip />
        </>
      ) : (
        <main className="min-h-0 flex-1">
          <WaitingScreen />
        </main>
      )}
    </div>
  );
}
