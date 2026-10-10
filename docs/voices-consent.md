# Voices of the valley: contribution and consent process

Status: DRAFT for review by community partners. No recordings exist yet, and no voice in this project is recorded, synthesised or translated by machine. (The Atlas
audio guide is separate: its English clips are machine-generated narration, see the README.)

## 1. Principles

- Speakers decide. Each speaker chooses what is recorded, what is published, the credit line and the licence.
- Community consent can be collective as well as individual. Recording partners should agree a local protocol before any recording starts.
- No voice, transcript or quote is added to the app without a signed consent record held by the partner organisation.
- Withdrawal is always possible (section 7).

## 2. Who records

Recording is done by local partners, not by the app team. Candidate partner, confirmed in this review:

- **Idara Baraye Taleem-o-Taraqi (IBT)**, Torwali. IBT runs Mother Tongue Based multilingual education for the Torwali community; its first school opened in Bahrain in August 2008 (Mhoon School, now an ILM school), and, as of the page's count, six such schools so far (Bahrain, Kedam and Chail). Source: https://torwali.org/en/node/19 (fetched). The page gives no phone or email; it links to a contact form at https://torwali.org/en/contact.

Other partners, including projects for Gawri (Kalam) and Ushojo, are not yet confirmed. Do not list an organisation here until its role has been checked with it directly.


## 3. Steps

1. Partner agrees the local protocol and the language list with the app team.
2. Speaker is approached through the partner, in person, in the speaker's own language.
3. Speaker reads or hears the consent form (section 4) and asks questions. A cooling-off day is offered.
4. Speaker signs or gives recorded verbal consent, and chooses the licence and credit line.
5. Recording takes place. Speaker may stop at any time.
6. Partner transcribes in the original language. A translation is made by a fluent speaker and checked with the speaker.
7. Speaker reviews the transcript and translation and approves the final text.
8. Partner gives the app team a consent record ID (consent_ref), the licence, the credit and the approved files.
9. App team checks the record (section 8), then publishes.

## 4. Consent form (draft text)

### English

I agree to take part in a recording for the "Voices of the valley" project of Tiny Atlas.

- I understand what the recording is for, who will see it, and where it will appear.
- I can ask for any part to be removed, or for the recording to be withdrawn, at any time before or after publication, as described in section 7.
- I choose the name or pseudonym to be credited: ____________________
- I choose the licence: [ ] CC BY-SA 4.0 (others may reuse and adapt, and must share alike)  [ ] CC BY-NC 4.0 (others may reuse and adapt for non-commercial purposes only)
- I ask that the following be left out: [ ] my face (photos)  [ ] my home address or village house  [ ] names of family members  [ ] other: ____________
- I agree that the recording and transcript may be kept in an archive, and I know that archives may be public.
- I have had the chance to ask questions. I am taking part freely and no payment has been required of me to take part.

Speaker: ____________________  Date: __________  Partner representative: ____________________
Consent record ID: __________

### Plain language (for the speaker to read aloud)

We want to record you speaking in your own language about things you choose. We will write down what you say and translate it into English. The recording may be played in this app next to the place it is about, with your name or the name you choose.

You decide: your name or a made-up name, which licence to use, and what to leave out. You can stop at any time. You can ask us to remove your recording later, and we will take it down from the app. If it has already been copied by others, we cannot always remove those copies, and we will say so.

We will not add your face, your home address or anything you did not agree to. No one will use your voice to make new speech. You can take a day to think about it before you sign.

## 5. What is stored

- Audio file (original, as recorded).
- Transcript in the original language, as approved by the speaker.
- English translation, as approved by the speaker.
- Speaker credit (name or pseudonym), licence choice, consent record ID, place, and recording date.
- The signed or recorded consent form, kept by the partner organisation. It is not published.

Not stored: contact details, addresses, identity document numbers, photos of the speaker unless the speaker has agreed.

## 6. Licence choice

The speaker chooses one licence per recording.

- **CC BY-SA 4.0**: others may share and adapt, including commercially, if they credit the speaker and share their adaptations under the same licence. Source: https://creativecommons.org/licenses/by-sa/4.0/
- **CC BY-NC 4.0**: others may share and adapt, with credit, for non-commercial purposes only. It has no share-alike clause. Source: https://creativecommons.org/licenses/by-nc/4.0/

The deeds are summaries; the full legal code governs.

## 7. Right to withdraw

- The speaker, or the partner on their behalf, can withdraw at any time. The recording is removed from `web/data/voices.json` and from the audio store, and the consent_ref is marked withdrawn in the partner's records.
- Withdrawal does not reach copies already downloaded by others under the licence. The app says so when it is asked.
- Withdrawal requests are handled within 14 days by the partner.

## 8. Payment and credit

- Speakers are credited by the name or pseudonym they choose, with their stated role (for example "storyteller, Bahrain").
- Speakers are paid for their time at a rate agreed with the partner, before recording. The payment is not linked to the content of the recording, and is not paid by the app team directly. The amount is not published in this repository.
- The partner organisation is credited on each recording it supplies.

## 9. Privacy

- No faces in published photos or video.
- No addresses, village house names or family names unless the speaker asks for them to be used.
- Sensitive topics (violence, displacement, religion, health) are recorded only if the speaker wants to and are reviewed before publishing.

## 10. Review before publishing

Before any recording goes live:

1. Partner confirms the consent record and the licence in writing.
2. Transcript and translation are checked by the speaker and by a second fluent speaker.
3. The speaker's credit line is confirmed.
4. The recording passes the schema test (`backend/tests/test_voices.py`): consent_ref, licence and speaker_credit are present, and each language has a source.
5. The app team does a final listen-through.

## 11. Sources on ethical oral-history practice

- Oral History Association, Principles and Best Practices (adopted 2018). Documents: core values, best practices, ethics, and a guide for participants. https://oralhistory.org/principles-and-best-practices-revised-2018/ (fetched)
- Endangered Languages Archive (ELAR), deposit information (search result, not fetched). Access and consent are set by the depositor, and ELAR asks depositors to confirm consent for new recordings. https://eldp.access.preservica.com/deposit-with-elar/ (search result; ELAR's current licence and metadata requirements were not found and should be requested from elar@elararchive.org)
- Creative Commons licence deeds. https://creativecommons.org/licenses/by-sa/4.0/ and https://creativecommons.org/licenses/by-nc/4.0/
- CARE Principles for Indigenous Data Governance (Collective benefit, Authority to control, Responsibility, Ethics). https://casrai.org/learn/what-are-the-care-principles (not fetched in this review; unverified)
