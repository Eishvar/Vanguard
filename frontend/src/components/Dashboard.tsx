import AppSidebar from "./AppSidebar";
import TopHeader from "./TopHeader";
import TacticalMap from "./TacticalMap";
import MissionControls from "./MissionControls";
import MissionLogs from "./MissionLogs";
import SurvivorReportCard from "./SurvivorReportCard";

const Dashboard = () => {
  return (
    <div className="h-screen flex overflow-hidden">
      {/* Hidden: mounted for SSE (TacticalMap dispatches vanguard:launch / vanguard:inject) */}
      <div className="hidden"><MissionControls /></div>

      <AppSidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopHeader />

        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* TacticalMap — fills available width */}
          <div className="flex-1 min-w-0">
            <TacticalMap />
          </div>

          {/* Right column */}
          <div className="w-80 shrink-0 flex flex-col border-l border-border">
            {/* Top half: inline survivor report card */}
            <div className="h-1/2 overflow-hidden border-b border-border">
              <SurvivorReportCard inline />
            </div>

            {/* Bottom half: execution log */}
            <div className="h-1/2 overflow-hidden">
              <MissionLogs />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
