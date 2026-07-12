export class MatchServiceError extends Error {
  constructor(
    public readonly code:
      | 'self_challenge'
      | 'opponent_not_found'
      | 'not_friends'
      | 'match_not_found'
      | 'match_not_participant'
      | 'match_not_owned'
      | 'match_host_inactive'
      | 'match_not_pending'
      | 'match_not_accepted'
      | 'match_not_ready'
      | 'match_not_in_progress'
      | 'match_config_incomplete'
      | 'match_result_invalid'
      | 'match_tempo_answer_invalid'
      | 'match_already_completed'
      | 'match_version_conflict'
      | 'match_not_completed'
      | 'match_rematch_unavailable'
      | 'match_host_transfer_unavailable'
      | 'participant_not_invited',
  ) {
    super(code)
  }
}
