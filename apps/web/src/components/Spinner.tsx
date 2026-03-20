export default function Spinner({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex items-center gap-3 py-12 justify-center">
      <div className="w-5 h-5 rounded-full border-2 border-[#2C5F45] border-t-transparent animate-spin" />
      <span className="text-sm text-gray-400">{text}</span>
    </div>
  )
}
