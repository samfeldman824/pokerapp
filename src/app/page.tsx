import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-300 relative overflow-hidden font-sans selection:bg-amber-500/30">
      {/* Atmosphere / Noise / Lighting */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_0%,#064e3b,transparent_70%)] opacity-40"></div>
      <div className="absolute inset-0 pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAuMDUiLz4KPC9zdmc+')] opacity-20 mix-blend-overlay"></div>
      
      {/* Decorative Suits */}
      <div className="absolute top-20 left-10 text-8xl text-zinc-800/20 rotate-12 select-none">♠</div>
      <div className="absolute bottom-40 right-10 text-9xl text-amber-900/10 -rotate-12 select-none">♦</div>
      <div className="absolute top-1/2 left-1/4 text-6xl text-red-900/10 rotate-45 select-none">♥</div>
      <div className="absolute bottom-20 left-1/3 text-7xl text-zinc-800/20 -rotate-6 select-none">♣</div>

      <div className="max-w-5xl mx-auto px-6 py-24 relative z-10 flex flex-col items-center justify-center min-h-[80vh] text-center">
        
        <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full border border-emerald-900/50 bg-emerald-950/30 backdrop-blur-sm text-emerald-400 text-sm font-medium tracking-wide mb-8">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          Live Multiplayer Poker
        </div>

        <h1 className="text-6xl md:text-8xl font-serif font-bold text-white mb-6 tracking-tight drop-shadow-2xl">
          Poker<span className="text-amber-500 italic">Now</span> Clone
        </h1>
        
        <p className="text-xl md:text-2xl text-zinc-400 max-w-2xl mb-12 font-light leading-relaxed">
          Real-time No-Limit Hold&apos;em — <br className="hidden md:block"/>
          <span className="text-zinc-200 font-medium">no signup required.</span>
        </p>

        <Link 
          href="/create"
          className="group relative inline-flex items-center justify-center px-10 py-5 font-bold text-zinc-950 bg-amber-500 hover:bg-amber-400 transition-all duration-300 shadow-[0_0_40px_-10px_rgba(245,158,11,0.5)] hover:shadow-[0_0_60px_-15px_rgba(245,158,11,0.7)] hover:-translate-y-1"
        >
          <span className="absolute inset-0 border border-amber-300 scale-105 opacity-0 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500"></span>
          <span className="tracking-widest uppercase text-lg">Create Game</span>
        </Link>

        {/* How it works */}
        <div className="mt-32 w-full grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="flex flex-col items-center text-center p-8 rounded-2xl bg-zinc-900/30 border border-zinc-800/50 backdrop-blur-sm relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-b from-emerald-900/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <span className="text-4xl font-serif text-amber-500/50 mb-4">01</span>
            <h3 className="text-xl text-white font-medium mb-3">Create</h3>
            <p className="text-zinc-500">Set up your table, stack sizes, and blinds in seconds.</p>
          </div>
          
          <div className="flex flex-col items-center text-center p-8 rounded-2xl bg-zinc-900/30 border border-zinc-800/50 backdrop-blur-sm relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-b from-amber-900/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <span className="text-4xl font-serif text-amber-500/50 mb-4">02</span>
            <h3 className="text-xl text-white font-medium mb-3">Share</h3>
            <p className="text-zinc-500">Send the unique invite link to your friends. No accounts needed.</p>
          </div>
          
          <div className="flex flex-col items-center text-center p-8 rounded-2xl bg-zinc-900/30 border border-zinc-800/50 backdrop-blur-sm relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-b from-red-900/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <span className="text-4xl font-serif text-amber-500/50 mb-4">03</span>
            <h3 className="text-xl text-white font-medium mb-3">Play</h3>
            <p className="text-zinc-500">Take your seat and let the cards fly. Real-time action.</p>
          </div>
        </div>

      </div>
    </main>
  );
}
