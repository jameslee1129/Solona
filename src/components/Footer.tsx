export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-12 border-t border-white/10 py-6 text-center text-xs text-white/50">
      <div className="mx-auto w-full max-w-6xl px-4"> 
        <span className="block">© {year} <a href="https://x.com/TryTradeTalk" className="text-white">TradeTalk</a></span>
        <span className="block">Made With ❤️ By <a href="https://x.com/spenndev" className="text-white">Spenn Development</a></span>
      </div>
    </footer>
  );
}

