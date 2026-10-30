// Inhalte des Teamevents Europapark 2026 (Stand Oktober 2026). Die
// Infotexte sind Standardwerte; die Organisatorin kann sie auf der Seite
// anpassen (gespeichert als Überlagerung pro Block). Texte in eckigen
// Klammern sind Platzhalter: nur für die Organisatorin sichtbar, für alle
// anderen wird die Zeile ausgeblendet, bis sie ausgefüllt ist.
// Textregeln siehe teamevent-programm.ts.

import type { InfoBlock, CheckItem, AdminPhase, Einstieg } from './teamevent-programm'

export const EP_SLUG = 'europapark-2026'
export const EP_ABFAHRT_DATUM = '2026-10-23'
/** Eingabeschluss für Ausweisdaten und Allergien (16. Oktober 2026, 20.00 Uhr Schweizer Zeit). */
export const EP_FRIST_EINGABE = '2026-10-16T20:00:00+02:00'
export const EP_FRIST_EINGABE_TEXT = 'Bis 16. Oktober, 20.00 Uhr'

/** Rufnamen im Team, wo sie vom Vornamen im Konto abweichen. */
export const EP_RUFNAMEN: Record<string, string> = { Franziska: 'Fränzi', Emese: 'Mesi' }
export const rufname = (fullName: string) => { const v = fullName.split(/\s+/)[0] ?? fullName; return EP_RUFNAMEN[v] ?? v }

/** Menü im Captain's Finest (Freitag 19.00 Uhr), Auswahl pro Gang. */
export const EP_MENUE = {
  vorspeise: ['Caesar Salad', 'Shrimp Singapur'],
  hauptgang: ['American Cheeseburger', 'Spaghetti mit Garnelen', 'Kräuterseitling Risotto'],
  dessert: ['Schokoladen Karamell Tartelette', 'Crème Brûlée mit Passionsfruchtsorbet', 'kein Dessert gewünscht'],
}

/** Zimmer, Reservation und Abendessen pro Person (Stand Oktober 2026);
 *  beim ersten Aufruf den Konten zugeordnet, danach von der Organisatorin
 *  auf der Seite gepflegt. zimmerMit = Vorname der Partnerin, null = Einzelzimmer. */
/** gast = Person ohne Portal Konto (z. B. Odette): nur Zimmer, Reservation und Menü. */
export type EpDetail = { vorname: string; alias?: string[]; gast?: boolean; zimmerMit: string | null; resName: string; resNr: string; vorspeise: string; hauptgang: string; dessert: string }
export const EP_DETAILS: EpDetail[] = [
  { vorname: 'Valérie', zimmerMit: 'Peter', resName: 'Peter Diserens', resNr: 'H14223618', vorspeise: 'Caesar Salad', hauptgang: 'American Cheeseburger', dessert: 'Schokoladen Karamell Tartelette' },
  { vorname: 'Peter', zimmerMit: 'Valérie', resName: 'Peter Diserens', resNr: 'H14223618', vorspeise: 'Shrimp Singapur', hauptgang: 'American Cheeseburger', dessert: 'Crème Brûlée mit Passionsfruchtsorbet' },
  { vorname: 'Fränzi', alias: ['Franziska'], zimmerMit: 'Paola', resName: 'Franziska Rindlisbacher', resNr: 'H14223623', vorspeise: 'Shrimp Singapur', hauptgang: 'American Cheeseburger', dessert: 'Schokoladen Karamell Tartelette' },
  { vorname: 'Paola', zimmerMit: 'Fränzi', resName: 'Franziska Rindlisbacher', resNr: 'H14223623', vorspeise: 'Caesar Salad', hauptgang: 'American Cheeseburger', dessert: 'Crème Brûlée mit Passionsfruchtsorbet' },
  { vorname: 'Dinusha', zimmerMit: 'Alessandra', resName: 'Dinusha Atapattu', resNr: 'H14223621', vorspeise: 'Shrimp Singapur', hauptgang: 'American Cheeseburger', dessert: 'Schokoladen Karamell Tartelette' },
  { vorname: 'Alessandra', zimmerMit: 'Dinusha', resName: 'Dinusha Atapattu', resNr: 'H14223621', vorspeise: 'Caesar Salad', hauptgang: 'Spaghetti mit Garnelen', dessert: 'Crème Brûlée mit Passionsfruchtsorbet' },
  { vorname: 'Daniela', zimmerMit: 'Annegret', resName: 'Daniela Tschannen', resNr: 'H14223620', vorspeise: 'Caesar Salad', hauptgang: 'Kräuterseitling Risotto', dessert: 'Schokoladen Karamell Tartelette' },
  { vorname: 'Annegret', zimmerMit: 'Daniela', resName: 'Daniela Tschannen', resNr: 'H14223620', vorspeise: 'Caesar Salad', hauptgang: 'American Cheeseburger', dessert: 'Crème Brûlée mit Passionsfruchtsorbet' },
  { vorname: 'Neya', zimmerMit: 'Amina', resName: 'Neya Krishnamoorthy', resNr: 'H14249580', vorspeise: 'Caesar Salad', hauptgang: 'American Cheeseburger', dessert: 'Crème Brûlée mit Passionsfruchtsorbet' },
  { vorname: 'Amina', zimmerMit: 'Neya', resName: 'Neya Krishnamoorthy', resNr: 'H14249580', vorspeise: 'Caesar Salad', hauptgang: 'American Cheeseburger', dessert: 'Crème Brûlée mit Passionsfruchtsorbet' },
  { vorname: 'Mesi', alias: ['Emese'], zimmerMit: 'Odette', resName: 'Emese Diserens', resNr: 'H14223625', vorspeise: 'Shrimp Singapur', hauptgang: 'American Cheeseburger', dessert: 'Schokoladen Karamell Tartelette' },
  { vorname: 'Odette', gast: true, zimmerMit: 'Mesi', resName: 'Emese Diserens', resNr: 'H14223625', vorspeise: 'Caesar Salad', hauptgang: 'Kräuterseitling Risotto', dessert: 'Crème Brûlée mit Passionsfruchtsorbet' },
  { vorname: 'Katarina', zimmerMit: 'Amanda', resName: 'Katarina Vuksanovic', resNr: 'H14223624', vorspeise: 'Caesar Salad', hauptgang: 'American Cheeseburger', dessert: 'Schokoladen Karamell Tartelette' },
  { vorname: 'Amanda', zimmerMit: 'Katarina', resName: 'Katarina Vuksanovic', resNr: 'H14223624', vorspeise: 'Caesar Salad', hauptgang: 'Kräuterseitling Risotto', dessert: 'Crème Brûlée mit Passionsfruchtsorbet' },
  { vorname: 'Noah', zimmerMit: 'Bianka', resName: 'Noah Diserens', resNr: 'H14223619', vorspeise: 'Shrimp Singapur', hauptgang: 'American Cheeseburger', dessert: 'Schokoladen Karamell Tartelette' },
  { vorname: 'Bianka', zimmerMit: 'Noah', resName: 'Noah Diserens', resNr: 'H14223619', vorspeise: 'Shrimp Singapur', hauptgang: 'Kräuterseitling Risotto', dessert: 'Crème Brûlée mit Passionsfruchtsorbet' },
  { vorname: 'Andrea', zimmerMit: null, resName: 'Andrea Brandt', resNr: 'H14223604', vorspeise: 'Caesar Salad', hauptgang: 'Spaghetti mit Garnelen', dessert: 'kein Dessert gewünscht' },
  { vorname: 'Laura', zimmerMit: null, resName: 'Laura Gerisch Rudin', resNr: 'H14223638', vorspeise: 'Caesar Salad', hauptgang: 'Spaghetti mit Garnelen', dessert: 'Crème Brûlée mit Passionsfruchtsorbet' },
  { vorname: 'Anita', zimmerMit: null, resName: 'Anita Trachsel', resNr: 'H14264362', vorspeise: 'Caesar Salad', hauptgang: 'Kräuterseitling Risotto', dessert: 'Schokoladen Karamell Tartelette' },
]

/** Teilnehmende beim ersten Aufruf (Vornamen aus der Zimmereinteilung,
 *  mit Kurzformen); die Organisatorin passt die Liste auf der Seite an. */
export const EP_TEILNEHMER_VORNAMEN: Array<{ vorname: string; alias?: string[] }> = [
  { vorname: 'Valérie' }, { vorname: 'Peter' },
  { vorname: 'Fränzi', alias: ['Franziska'] }, { vorname: 'Paola' },
  { vorname: 'Dinusha' }, { vorname: 'Alessandra' },
  { vorname: 'Daniela' }, { vorname: 'Annegret' },
  { vorname: 'Neya' }, { vorname: 'Amina' },
  { vorname: 'Mesi', alias: ['Emese'] },
  { vorname: 'Katarina' }, { vorname: 'Amanda' },
  { vorname: 'Noah' }, { vorname: 'Bianka' },
  { vorname: 'Andrea' }, { vorname: 'Anita' }, { vorname: 'Laura' },
]

export const EP_INFO_BLOECKE: InfoBlock[] = [
  { id: 'ueberblick', titel: 'Überblick', ort: 'info', zeilen: [
    'Freitag, 23. und Samstag, 24. Oktober 2026 im Europapark Rust',
    'Übernachtung im Hotel Bell Rock',
    'Hin und zurück mit dem Privatbus',
    'Hotelzimmer und Parktickets für beide Tage sind bezahlt und bestätigt, niemand muss etwas vorstrecken',
    'Der Park ist an beiden Tagen bis 18.00 Uhr offen',
  ] },
  { id: 'abfahrt', titel: 'Abfahrt am Freitag, 23. Oktober', ort: 'info', zeilen: [
    'Kehrsatz, Dentalpraxis, Belpstrasse 30. Der Bus fährt um 8.00 Uhr, bitte spätestens um 7.45 Uhr da sein',
    'Bern, Kunstmuseum, Hodlerstrasse 8 bis 12. Bitte um 8.15 Uhr da sein, der Bus hält vor dem Eingang auf dem markierten Busparkfeld und fährt ca. um 8.30 Uhr weiter',
    'Unterwegs machen wir eine kurze Pause, der Bus hat keine Toilette',
    'Ankunft im Europapark zwischen 11.00 und 12.00 Uhr',
  ] },
  { id: 'tag1', titel: 'Tag 1, Freitag 23. Oktober', ort: 'info', zeilen: [
    '11.00 bis 12.00 Uhr Ankunft, Gepäck an der Rezeption abgeben und direkt los in den Park',
    'Alternativ Pool und Wellnessbereich, den ganzen Tag nutzbar',
    'Ab 15.30 Uhr Zimmer beziehen, mit dem Online Check in in der Europapark Hotels App ohne Rezeption',
    'Bis 18.00 Uhr freie Zeit im Park',
    '18.45 Uhr Treffpunkt in der Lobby vom Hotel Bell Rock',
    '19.00 Uhr Abendessen im Restaurant Captain\'s Finest im Hotel Bell Rock',
    'Übernachtung im Hotel Bell Rock',
  ] },
  { id: 'tag2', titel: 'Tag 2, Samstag 24. Oktober', ort: 'info', zeilen: [
    '7.00 bis 10.00 Uhr Frühstück im Hotel',
    'Ab 8.15 Uhr dürfen Hotelgäste in den Park, 45 Minuten vor allen anderen',
    'Bis 11.00 Uhr Check out, das Gepäck kann an der Rezeption deponiert werden',
    'Bis 18.00 Uhr freie Zeit im Park, der Park schliesst um 18.00 Uhr',
    'Pool und Wellnessbereich sind den ganzen Tag nutzbar, auch nach dem Check out',
    'Bitte vor der Abfahrt noch im Park essen, unterwegs gibt es keinen Essenshalt',
    '18.30 Uhr Rückfahrt ab Hotel Bell Rock',
    'Ca. 21.30 Uhr Ankunft in Bern und Kehrsatz',
  ] },
  { id: 'essen', titel: 'Essen und Getränke', ort: 'info', zeilen: [
    'Das Abendessen am Freitag und das Frühstück am Samstag übernimmt die Praxis',
    'Die übrigen Mahlzeiten bezahlt jede und jeder selbst, im Park gibt es viele Restaurants und Shops',
  ] },
  // Zeilen im Format «Name: Text» zeigen den Namen fett (die zwei Apps)
  { id: 'apps', titel: 'Apps', ort: 'info', zeilen: [
    'Bitte vor der Reise diese zwei Apps herunterladen, ohne die Europapark Hotels App geht es nicht',
    'Europapark Hotels App: Darüber läuft der Online Check in am 23. Oktober ab 6.00 Uhr, nur die eigenen Angaben eingeben, die Vorregistrierung macht Bianka vorher für alle. In der App sind die digitalen Parktickets für beide Tage und der digitale Zimmerschlüssel. Mitteilungen einschalten, so kommt sofort die Nachricht, wenn das Zimmer bereit ist, oft schon vor 15.30 Uhr',
    'Europapark & Rulantica App: Parkplan und aktuelle Wartezeiten bei jeder Attraktion',
  ] },
]

export const EP_EINSTIEG: Record<Einstieg, string> = {
  kehrsatz: 'Kehrsatz um 7.45 Uhr',
  bern: 'Kunstmuseum Bern um 8.15 Uhr',
}

export const EP_CHECKLISTE: CheckItem[] = [
  { id: 'ausweis', art: 'ausweis', titel: 'Ausweis eintragen',
    text: 'ID oder Reisepass mit Nummer und Ablaufdatum. Das Hotel braucht die Angaben für die Vorregistrierung. Nach der Frist schliesst die Eingabe, die Vorregistrierung beim Hotel muss dann selbst gemacht werden',
    frist: EP_FRIST_EINGABE_TEXT, fristBis: EP_FRIST_EINGABE,
    geschlossenText: 'Die Eingabe ist seit 16. Oktober, 20.00 Uhr geschlossen. Die Vorregistrierung beim Hotel muss nun selbst gemacht werden, über den Link MEINE REISE in der Buchungsbestätigung oder in der Europapark Hotels App' },
  { id: 'einstieg', art: 'einstieg', titel: 'Einstiegsort wählen' },
  { id: 'allergien', art: 'allergien', titel: 'Allergien melden',
    text: 'Allergien oder Unverträglichkeiten, die das Restaurant kennen sollte. Nach der Frist schliesst die Eingabe',
    frist: EP_FRIST_EINGABE_TEXT, fristBis: EP_FRIST_EINGABE,
    geschlossenText: 'Die Eingabe ist seit 16. Oktober, 20.00 Uhr geschlossen. Änderungen bitte direkt Bianka melden' },
  { id: 'app-hotels', art: 'manuell', titel: 'Europapark Hotels App herunterladen',
    text: 'Nötig für den Online Check in, die digitalen Parktickets für beide Tage, den digitalen Zimmerschlüssel und die Mitteilung, sobald das Zimmer bereit ist' },
  { id: 'app-park', art: 'manuell', titel: 'Europapark & Rulantica App herunterladen' },
  { id: 'checkin', art: 'manuell', titel: 'Am 23. Oktober ab 6.00 Uhr online einchecken',
    text: 'In der Europapark Hotels App. Mitteilungen einschalten, so kommt sofort die Nachricht, wenn das Zimmer bereit ist, oft schon vor 15.30 Uhr' },
  { id: 'ausweis-einpacken', art: 'manuell', titel: 'ID oder Reisepass einpacken' },
  { id: 'fotos', art: 'fotos', titel: 'Fotos vom Ausflug hochladen', text: 'Im Fotoalbum von diesem Teamevent' },
]

/** Admin Checkliste der Organisatorin. Texte bleiben auf Englisch, wie vorgegeben. */
export const EP_ADMIN_PHASEN: AdminPhase[] = [
  { id: 'page', titel: 'Teamevent page', frist: 'this week', items: [
    { id: 'page-1', vorerledigt: true, titel: 'Send the prompt to the HR Platform chat.', text: 'Info section, personal checklists for the participants and your admin checklist on the Teamevent page.' },
    { id: 'page-2', titel: 'Check the Teamevent page with an employee account.', text: 'Info complete and readable on the phone, checklist ticks save, ID details and allergies visible only to you.' },
    { id: 'page-3', vorerledigt: true, titel: 'Fill in the open placeholders on the page.', text: 'Done, park closes at 18.00 on both days, allergies deadline 15 October, no drinks rule on the page.' },
  ] },
  { id: 'week1', titel: 'This week', frist: 'by Friday 9 October', items: [
    { id: 'w1-1', vorerledigt: true, titel: 'Decide whether Sarah joins.', text: 'Decided, Sarah and Fabienne cannot come. 19 people, 11 rooms, no changes to the order list or the room plan.' },
    { id: 'w1-2', titel: "Clarify Daniela's dessert and Andrea's empty dessert.", text: 'The order list says Schokolade for Daniela (menu only has the Tartelette) and nothing for Andrea. Ask both before sending the restaurant email.' },
    { id: 'w1-3', titel: 'Ask the team about allergies and intolerances.', text: 'The risotto has hazelnuts, the burger has bacon, two dishes have shrimp. Collect anything the kitchen needs to know.' },
    { id: 'w1-4', titel: 'Mark which double rooms need twin beds.', text: 'For colleagues sharing a room ask the hotel for two separate beds. Add this to the rooming list you attach.' },
    { id: 'w1-5', vorerledigt: true, titel: 'Send the email to the bus company.', text: 'Times with the new departure at 18.30, second stop, who organises the bus parking, driver overnight stay and meals, driver phone number, what the price includes.' },
    { id: 'w1-6', vorerledigt: true, titel: 'Send the email to the hotel.', text: 'Rooming list, twin beds, driver room, luggage storage, spa after check out, park tickets, breakfast, invoice. Bus parking is left out until the bus company has answered.' },
    { id: 'w1-7', vorerledigt: true, titel: "Send the menu email to Captain's Finest.", text: 'Dish counts, name list as attachment, drinks, one bill for the practice.' },
    { id: 'w1-8', vorerledigt: true, titel: 'Check that park tickets for both days are booked.', text: 'Done, the two day tickets for all 19 people are paid and confirmed.' },
    { id: 'w1-9', titel: 'Talk to Alessandra privately.', text: 'She had her accident on the way to work on 14 September. Check whether she feels fit to come and what she is comfortable with. If she is still on accident leave by then, think about how the trip fits with her AXA case before she goes on rides.' },
    { id: 'w1-10', titel: 'Agree the budget and cost rules with Valérie.', text: 'Who pays drinks at dinner, lunches, snacks, spa treatments, minibar. Write it down once so the team gets one clear message.' },
    { id: 'w1-11', titel: 'Decide how the two days count as working time.', text: 'Friday is a normal working day for most, Saturday is not. Decide one rule for full time and part time staff (also those who never work on Fridays) and how it goes into the HR platform.' },
  ] },
  { id: 'week2', titel: 'Two weeks before', frist: 'by Friday 16 October', items: [
    { id: 'w2-1', vorerledigt: true, titel: 'Pay the hotel reservation in full.', text: 'Done, all rooms are paid in full and confirmed, so the online check in works on the day.' },
    { id: 'w2-2', titel: 'Complete the pre registration for everyone.', text: 'Do it before the trip so the team can check in online on the day. Through the MEINE REISE link in the booking confirmation or a later hotel email. You need the ID or passport number and expiry date of everyone, which the team enters on the Teamevent page in the HR Portal.' },
    { id: 'w2-3', vorerledigt: true, titel: 'Enable the Teamevent page in the HR Portal.', text: 'Done on 8 October, the page is live for the whole team. Still worth a quick check with a normal employee account that the ID details are visible only to you and that photo upload works.' },
    { id: 'w2-4', titel: 'Collect written confirmations from bus, hotel and restaurant.', text: 'Save all answers and booking numbers in one folder so anyone in the organising team can find them.' },
    { id: 'w2-5', titel: 'Send the final rooming list to the hotel.', text: 'Names per room, twin beds marked, driver room if needed.' },
    { id: 'w2-6', titel: 'Send the info mail to the team and open a group chat.', text: 'Point everyone to the Teamevent page in the HR Portal. A group chat is the fastest way to reach everyone in the park.' },
    { id: 'w2-7', titel: 'Remind everyone about ID and documents.', text: 'We cross into Germany. Everyone needs a valid ID or passport, colleagues without a Swiss or EU passport also bring their residence permit.' },
    { id: 'w2-8', titel: 'Block 23 October in ZaWin and move patients.', text: 'Also check that Saturday 24 October is not one of the Saturday openings of 2026.' },
    { id: 'w2-9', titel: 'Organise emergency cover for Friday.', text: 'Who takes dental emergencies while the whole team is away. Put the number on the voicemail and the website.' },
    { id: 'w2-10', titel: 'Warn the dental lab and suppliers.', text: 'Nobody receives deliveries on Friday 23 October.' },
    { id: 'w2-11', titel: 'Check the company card limit and pay any deposit.', text: 'Hotel, dinner and possibly tickets go in EUR. Make sure the card limit covers everything at once.' },
    { id: 'w2-12', titel: 'Plan parking at the practice.', text: 'Cars stay two days at the clinic. Make sure there are enough spaces and that the rented spots are not blocked.' },
    { id: 'w2-13', titel: 'Prepare small extras.', text: 'Name cards for dinner, a short welcome note in the rooms, a group photo moment, a few words from Valérie at dinner.' },
  ] },
  { id: 'final', titel: 'Final week', frist: '19 to 22 October', items: [
    { id: 'f-1', titel: 'Install the Europapark Hotels app and log in.', text: 'Use the same email address as for the booking. This is a different app from the Europapark & Rulantica app for the park.' },
    { id: 'f-2', titel: 'Check that everyone entered their ID details.', text: 'ID or passport number and expiry date for all 19 people. The entry closes for the team on 16 October at 20.00, remind anyone missing a few days earlier. Whoever misses it does the pre registration themselves.' },
    { id: 'f-3', titel: 'Remind the team to install both apps.', text: 'Europapark Hotels app for check in, room key and room ready message, Europapark & Rulantica app for the park map and waiting times. Ask in the group chat who still needs help.' },
    { id: 'f-4', titel: 'Call the bus company to reconfirm.', text: "Time, both stops and the driver's mobile number." },
    { id: 'f-5', titel: 'Reconfirm hotel and restaurant by phone.', text: 'Group reservations Europapark +49 7822 860 5676, table reservations +49 7822 860 5922.' },
    { id: 'f-6', titel: 'Check the weather and update the packing tips.', text: 'Rain jacket, warm layer for the evening.' },
    { id: 'f-7', titel: 'Print and save everything twice.', text: 'Rooming list, menu list with names, emergency contacts, booking confirmations, tickets. Paper in your bag and PDFs on your phone.' },
    { id: 'f-8', titel: 'Pack a small first aid kit and water for the bus.', text: 'Plasters, painkillers, something against travel sickness, a few snacks for the evening drive.' },
    { id: 'f-9', titel: 'Switch on voicemail and website notice.', text: 'Activate on Thursday evening, switch off on Monday morning.' },
    { id: 'f-10', titel: 'Ask the bus company for a break on the way home.', text: 'The bus has no toilet. A break on the way there is confirmed, ask for one on the return trip too and plan a toilet stop in the hotel before departure at 18.30.' },
    { id: 'f-11', titel: 'Pack your own ID or passport for the German border.', text: 'Check it is valid, keep it in your hand luggage on the bus, and remind the team in the group chat the evening before.' },
  ] },
  { id: 'trip', titel: 'On the trip', frist: '23 and 24 October', items: [
    { id: 't-1', titel: 'Online check in from 6.00 on 23 October.', text: 'Everyone checks in in the Europapark Hotels app with their own details. Send a short reminder in the group chat in the morning and help anyone who gets stuck on the bus. Fallback is reception with the booking confirmation.' },
    { id: 't-2', titel: 'Headcount at Kehrsatz and at Kunstmuseum.', text: 'The bus is ready at the practice around 7.45. Agree beforehand how long it waits for latecomers.' },
    { id: 't-3', titel: 'At the hotel hand over luggage and collect tickets.', text: 'Give everyone their ticket and the meeting time for dinner.' },
    { id: 't-4', titel: 'Meet in the lobby at 18.45 for dinner.', text: 'Place the name cards so the service can serve each pre ordered dish.' },
    { id: 't-5', titel: 'Day 2 check out by 11.00.', text: 'All rooms cleared, keys back, luggage in storage, minibar settled by each person if that is the rule.' },
    { id: 't-6', titel: 'Headcount before departure at 18.30.', text: 'Nobody leaves the park without a message in the group chat.' },
    { id: 't-7', titel: 'Keep every receipt.', text: 'Photo of each receipt straight away, it saves time with the bookkeeping.' },
  ] },
  { id: 'after', titel: 'After the trip', frist: 'from 26 October', items: [
    { id: 'a-1', titel: 'Check the invoices against the offers and book them.', text: 'Hotel, bus and restaurant, booked as staff event under other personnel costs.' },
    { id: 'a-2', titel: 'Delete the ID details from the HR Portal.', text: 'Once the hotel stay is closed, remove the ID and passport numbers. They are only needed for the hotel registration.' },
    { id: 'a-3', titel: 'Thank the team and point to the photos.', text: 'Remind everyone to upload their pictures on the Teamevent page in the HR Portal. Ask before posting any photo on the practice website or social media.' },
    { id: 'a-4', titel: 'Write down what worked for 2027.', text: 'Two or three notes for next year while it is still fresh.' },
  ] },
]

/** Programm eines Ordners (Slug) — zurzeit nur Europapark 2026. */
export function programmFuer(slug: string) {
  if (slug !== EP_SLUG) return null
  return { bloecke: EP_INFO_BLOECKE, checkliste: EP_CHECKLISTE, adminPhasen: EP_ADMIN_PHASEN, einstieg: EP_EINSTIEG, teilnehmerVornamen: EP_TEILNEHMER_VORNAMEN, details: EP_DETAILS, menue: EP_MENUE }
}
