import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import { createPlanningCompaction } from './compaction-policy.js'

export default createPlanningCompaction(BasicCompactionEngine)
