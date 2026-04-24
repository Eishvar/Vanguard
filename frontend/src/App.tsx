import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IntroSequence } from "@/components/IntroSequence";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

// Expose logout globally so TopHeader can call it without prop drilling
let _setIntroComplete: ((v: boolean) => void) | null = null;
export function triggerLogout() {
  _setIntroComplete?.(false);
}

const App = () => {
  const [introComplete, setIntroComplete] = useState(false);
  _setIntroComplete = setIntroComplete;

  if (!introComplete) {
    return (
      <div className="h-screen w-screen" style={{ background: "#0a0f14" }}>
        <IntroSequence onComplete={() => setIntroComplete(true)} />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
