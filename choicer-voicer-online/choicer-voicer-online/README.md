# Choicer Voicer Online

Gioco web originale 1v1 di imitazione vocale. Un giocatore ascolta una clip, la imita al microfono e l'altro la giudica. Il punteggio finale combina analisi automatica della registrazione e voto dell'avversario.

## Funzioni
- Stanze private con codice a 5 caratteri
- 2 giocatori online in tempo reale con Socket.IO
- Registrazione microfono dal browser
- 10 clip vocali originali incluse
- Clip personalizzate caricabili dall'host
- Analisi automatica di durata, energia, andamento dinamico e zero-crossing
- Voto avversario 1–10
- Punteggio totale e classifica
- 6/8/10/12/16 round
- Rivincita
- Responsive per telefono

## Avvio locale
```bash
npm install
npm start
```
Apri `http://localhost:3000`.

## Render
Il progetto contiene `render.yaml`.
1. Carica il repository su GitHub.
2. Su Render scegli **New > Blueprint** e seleziona il repository.
3. Render userà automaticamente `npm install` e `npm start`.

In alternativa crea un Web Service Node con:
- Build Command: `npm install`
- Start Command: `npm start`

## Nota microfono
In produzione `getUserMedia` richiede HTTPS. Render fornisce HTTPS automaticamente.

## Clip personalizzate
Nel lobby l'host può aggiungere piccoli file audio (circa 1,5 MB max). Le clip rimangono solo nella stanza corrente e non vengono salvate su database.
