import type { WalkingSpeedModel } from '../../domain/walkingSpeedModel'
import { analyzePersonalWalkingHistory } from '../analysis/personalWalkingStats'
import {
  walkHistoryService,
  type WalkHistoryService,
} from '../history/walkHistoryService'
import { trainWalkingSpeedModel } from './walkingSpeedModel'

export async function loadCurrentWalkingSpeedModel(
  ownerUserId: string,
  historyService: WalkHistoryService = walkHistoryService,
): Promise<WalkingSpeedModel> {
  const records = await historyService.listCompletedSessions(ownerUserId)
  if (records.length === 0) {
    return trainWalkingSpeedModel([])
  }

  const summary = await analyzePersonalWalkingHistory(
    ownerUserId,
    records,
    historyService,
  )
  return trainWalkingSpeedModel(summary.comparisons)
}
