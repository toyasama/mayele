import type { PlayModePath } from './PlayModeTabs'

type PlayModeNavigationDialogProps = {
  targetPath: PlayModePath
  onCancel: () => void
  onConfirm: () => void
}

const modeLabels: Record<PlayModePath, string> = {
  '/jeu/solo': 'Solo',
  '/jeu/multijoueur': 'Multijoueur',
}

export function PlayModeNavigationDialog({ targetPath, onCancel, onConfirm }: PlayModeNavigationDialogProps) {
  return (
    <div className="play-mode-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="play-mode-dialog-title"
        aria-modal="true"
        className="card play-mode-dialog"
        role="dialog"
      >
        <span className="eyebrow">Partie en cours</span>
        <h2 id="play-mode-dialog-title">Revenir a l'accueil {modeLabels[targetPath]} ?</h2>
        <div className="play-mode-dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Rester
          </button>
          <button className="primary-button" type="button" onClick={onConfirm}>
            Confirmer
          </button>
        </div>
      </section>
    </div>
  )
}
