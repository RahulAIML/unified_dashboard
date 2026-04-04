import { motion } from "framer-motion"
import { BarChart3 } from "lucide-react"

interface Props {
  title?: string
  message?: string
  icon?: React.ReactNode
}

export function EmptyState({
  title = "No data available",
  message = "No activity has been recorded yet for this module.",
  icon,
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
        {icon ?? <BarChart3 className="w-6 h-6 text-muted-foreground" />}
      </div>
      <p className="font-semibold text-sm">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs">{message}</p>
    </motion.div>
  )
}
