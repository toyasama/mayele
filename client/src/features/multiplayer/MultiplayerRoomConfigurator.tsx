import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { DifficultyChoiceGrid, OperationChoiceGrid } from '../../components/ChallengeExperience'
import type { ChallengeMode } from '../../lib/api'
import { GAME_LABELS, LEVEL_LABELS, type GameLevel, type GameType } from '../../lib/game'
import {
  MAX_TEMPO_QUESTION_SECONDS,
  MIN_TEMPO_QUESTION_SECONDS,
  type RoomConfig,
} from '../../lib/multiplayerConfig'

type MultiplayerRoomConfiguratorProps = {
  authoritativeConfig: RoomConfig
  controlsDisabled: boolean
  editableConfig: RoomConfig
  onChange: (resolveNextConfig: (current: RoomConfig) => RoomConfig) => void
}

function selectedCount(config: RoomConfig) {
  return [config.challengeMode, config.game, config.level].filter(Boolean).length
}

function configLabel(config: RoomConfig) {
  return [
    config.challengeMode === 'tempo' ? 'Tempo' : config.challengeMode === 'sprint' ? 'Sprint' : 'Mode',
    config.game ? GAME_LABELS[config.game as GameType] : 'Opération',
    config.level ? LEVEL_LABELS[config.level as GameLevel] : 'Niveau',
  ]
}

export function MultiplayerRoomConfigurator({
  authoritativeConfig,
  controlsDisabled,
  editableConfig,
  onChange,
}: MultiplayerRoomConfiguratorProps) {
  const completion = selectedCount(authoritativeConfig)
  const labels = configLabel(authoritativeConfig)
  const [modeHelpOpen, setModeHelpOpen] = useState(false)

  useEffect(() => {
    if (!modeHelpOpen) return

    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModeHelpOpen(false)
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [modeHelpOpen])

  return (
    <div className="multiplayer-config-stage">
      <header className="multiplayer-config-heading">
        <div>
          <span className="eyebrow">Votre défi</span>
          <h2>{completion === 3 ? 'Prêt à envoyer' : 'Composez la partie'}</h2>
        </div>
        <div className="multiplayer-config-progress" aria-label={`${completion} choix sur 3`}>
          {[1, 2, 3].map((step) => <i className={completion >= step ? 'is-complete' : ''} key={step} />)}
          <strong>{completion}/3</strong>
        </div>
      </header>

      <div className="multiplayer-config-recap" aria-live="polite">
        {labels.map((label, index) => (
          <span className={completion > index ? 'is-selected' : ''} key={label}>
            <small>{index + 1}</small>{label}
          </span>
        ))}
      </div>

      <div className="multiplayer-config-board" aria-label="Configuration du défi">
        <div className="control-group multiplayer-config-row multiplayer-config-mode">
          <div className="multiplayer-mode-label">
            <span className="panel-label">Mode</span>
            <button
              type="button"
              className="multiplayer-mode-help-trigger"
              aria-label="Informations sur les modes de jeu"
              aria-haspopup="dialog"
              aria-expanded={modeHelpOpen}
              onClick={() => setModeHelpOpen(true)}
            >
              ?
            </button>
          </div>
          <div className="segmented-grid">
            {(['sprint', 'tempo'] as ChallengeMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`segment ${authoritativeConfig.challengeMode === mode ? 'active' : ''}`}
                disabled={controlsDisabled}
                onClick={() => onChange((current) => ({ ...current, challengeMode: mode }))}
              >
                <strong>{mode === 'sprint' ? 'Sprint' : 'Tempo'}</strong>
                <small>{mode === 'sprint' ? 'Contre la montre' : 'Question par question'}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="control-group multiplayer-config-row multiplayer-config-operation">
          <span className="panel-label">Opération</span>
          <OperationChoiceGrid
            value={authoritativeConfig.game}
            disabled={controlsDisabled}
            onSelect={(nextGame) => onChange((current) => ({ ...current, game: nextGame }))}
          />
        </div>

        <div className="control-group multiplayer-config-row multiplayer-config-level">
          <span className="panel-label">Niveau</span>
          <DifficultyChoiceGrid
            value={authoritativeConfig.level}
            disabled={controlsDisabled}
            onSelect={(nextLevel) => onChange((current) => ({ ...current, level: nextLevel }))}
          />
        </div>

        <div className="multiplayer-rule-panel multiplayer-config-rules">
          {editableConfig.challengeMode === 'tempo' ? (
            <>
              <label>
                Questions
                <input
                  type="number"
                  min={10}
                  max={50}
                  value={editableConfig.questionCount}
                  disabled={controlsDisabled}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.valueAsNumber
                    onChange((current) => ({
                      ...current,
                      questionCount: Number.isFinite(nextValue) ? nextValue : current.questionCount,
                    }))
                  }}
                />
              </label>
              <label>
                Secondes par question
                <input
                  type="number"
                  min={MIN_TEMPO_QUESTION_SECONDS}
                  max={MAX_TEMPO_QUESTION_SECONDS}
                  value={editableConfig.perQuestionTimeLimitSeconds}
                  disabled={controlsDisabled}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.valueAsNumber
                    onChange((current) => ({
                      ...current,
                      perQuestionTimeLimitSeconds: Number.isFinite(nextValue) ? nextValue : current.perQuestionTimeLimitSeconds,
                    }))
                  }}
                />
              </label>
            </>
          ) : editableConfig.challengeMode === 'sprint' ? (
            <label>
              Durée
              <select
                value={editableConfig.durationSeconds}
                disabled={controlsDisabled}
                onChange={(event) => {
                  const nextValue = Number(event.currentTarget.value)
                  onChange((current) => ({
                    ...current,
                    durationSeconds: Number.isFinite(nextValue) ? nextValue : current.durationSeconds,
                  }))
                }}
              >
                <option value={60}>60 secondes</option>
                <option value={90}>90 secondes</option>
                <option value={120}>120 secondes</option>
              </select>
            </label>
          ) : (
            <div className="multiplayer-rule-placeholder">
              <span aria-hidden="true">↗</span>
              <strong>Sprint ou Tempo&nbsp;?</strong>
            </div>
          )}
        </div>
      </div>

      {modeHelpOpen ? createPortal(
        <div
          className="multiplayer-mode-help-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setModeHelpOpen(false)
          }}
        >
          <section
            className="multiplayer-mode-help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="multiplayer-mode-help-title"
          >
            <header>
              <div>
                <span>Mode de jeu</span>
                <h2 id="multiplayer-mode-help-title">Sprint ou Tempo&nbsp;?</h2>
              </div>
              <button
                type="button"
                className="multiplayer-mode-help-close"
                aria-label="Fermer"
                autoFocus
                onClick={() => setModeHelpOpen(false)}
              >
                ×
              </button>
            </header>

            <div className="multiplayer-mode-help-descriptions">
              <article className={authoritativeConfig.challengeMode === 'sprint' ? 'active' : ''}>
                <span>Contre la montre</span>
                <strong>Sprint</strong>
                <p>Répondez correctement au plus grand nombre de questions avant la fin du chrono.</p>
              </article>
              <article className={authoritativeConfig.challengeMode === 'tempo' ? 'active' : ''}>
                <span>Question par question</span>
                <strong>Tempo</strong>
                <p>Chaque question possède son propre chrono. Le défi se termine après le nombre de questions choisi.</p>
              </article>
            </div>

            <button type="button" className="multiplayer-mode-help-done" onClick={() => setModeHelpOpen(false)}>
              C’est compris
            </button>
          </section>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
