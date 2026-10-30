'use client'

// Kamera im Browser für Computer ohne Kamera Modus des Dateidialogs: zeigt
// das Live Bild der Webcam und nimmt auf Knopfdruck ein Foto als JPEG auf.
// Am Handy braucht es das nicht, dort öffnet «Foto aufnehmen» die Kamera
// direkt über den Dateidialog.

import { useEffect, useRef, useState } from 'react'

export default function KameraDialog({ onFoto, onClose }: { onFoto: (f: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [bereit, setBereit] = useState(false)

  useEffect(() => {
    let aktiv = true
    if (!navigator.mediaDevices?.getUserMedia) { setFehler('Dieser Browser hat keinen Kamerazugriff. Bitte «Foto auswählen» nutzen.'); return }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(s => {
        if (!aktiv) { s.getTracks().forEach(t => t.stop()); return }
        streamRef.current = s
        const v = videoRef.current
        if (v) { v.srcObject = s; v.play().catch(() => { /* Autoplay blockiert, Bild erscheint beim ersten Frame */ }) }
        setBereit(true)
      })
      .catch(() => setFehler('Die Kamera konnte nicht geöffnet werden. Bitte den Zugriff erlauben oder «Foto auswählen» nutzen.'))
    return () => { aktiv = false; streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, [])

  function aufnehmen() {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth; c.height = v.videoHeight
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0)
    c.toBlob(b => { if (b) onFoto(new File([b], `kamera_${Date.now()}.jpg`, { type: 'image/jpeg' })) }, 'image/jpeg', 0.92)
  }

  return (
    <div className="fixed inset-0 z-[75] bg-black flex flex-col" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-4 py-3 text-white/90">
        <p className="text-sm font-semibold">Foto aufnehmen</p>
        <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 text-sm" aria-label="Schliessen">✕</button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center">
        {fehler ? <p className="text-white/80 text-sm px-6 text-center">{fehler}</p> : (
          <video ref={videoRef} playsInline muted className="max-w-full max-h-full object-contain" />
        )}
      </div>
      <div className="flex items-center justify-center gap-3 px-4 py-4">
        <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-sm font-semibold">Abbrechen</button>
        <button onClick={aufnehmen} disabled={!bereit || !!fehler} className="px-6 py-2.5 rounded-xl bg-white text-ink text-sm font-bold disabled:opacity-50">Aufnehmen</button>
      </div>
    </div>
  )
}
