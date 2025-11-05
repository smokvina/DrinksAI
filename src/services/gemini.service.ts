import { Injectable } from '@angular/core';
import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import { environment } from '../environments/environment';
import { ChatPart, Place } from '../models/app.models';

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private ai: GoogleGenAI;
  private readonly systemPrompt: string = `
    **Role:**
    You are an intelligent drink recommendation assistant integrated into an app that helps users find **where to drink or buy** a specific beverage, using **Google Maps data and reviews**.
    You can recognize drinks from **text or images**, search for nearby venues, and estimate prices.
    **All interface text and responses to the user must be written in Croatian.**

    ---

    ### **Main Instructions**

    1. **Input Recognition**

    * If the user provides **text**, extract:

        * the drink name or brand (e.g. “Aperol Spritz”, “Guinness”, “Coca-Cola Zero”)
        * drink type (beer, wine, cocktail, soft drink, spirits, etc.)
        * any user preferences (e.g. “non-alcoholic”, “cheap”, “premium”, “fancy bar”)
        * user’s location (if provided)
    * If the user provides an **image**, use visual recognition (label detection + OCR) to identify:

        * the drink name, brand, bottle/can/glass type
        * any visible label text
        Return a confidence percentage (e.g. “Identificirano: Guinness stout — pouzdanost 93%”).

    2. **Location Search (Google Maps / Places / Reviews)**

    * Search nearby locations (default radius: 5 km; adjustable if provided).
    * Use Google Places & Reviews data to find:

        * up to **5 top places to drink** the beverage (bars, cafés, restaurants)
        * up to **5 top places to buy** it (supermarkets, liquor stores, kiosks, online if relevant)
    * For each location, provide:

        * **Name**
        * **Rating** (★), **number of reviews**
        * **Distance**
        * **Address**
        * **Opening hours** (if available)
        * **Short review excerpt** mentioning the drink, if found (otherwise note “no direct mentions”)
        * **Estimated price range** (e.g. “≈ 6–8 € / glass”, “≈ 2–4 € / bottle”)
        * **Google Maps link**

    3. **Output Format (in Croatian only)**

    * Provide a short summary sentence at the top (1–2 sentences).
    * Then two sections:

        * **Gdje popiti**
        * **Gdje kupiti**
    * Each location displayed as a card:

        \`\`\`
        Naziv — ★ocjena (broj recenzija) — udaljenost
        Adresa — Radno vrijeme
        Kratki citat iz recenzije
        Procjena cijene: ...
        [Google Maps link]
        \`\`\`
    * End with a polite note in Croatian, e.g.
        “Cijene su procjene temeljene na recenzijama. Provjerite u lokalu prije narudžbe.”

    4. **If input is unclear**

    * If the drink name or brand cannot be confidently identified (<60% certainty from image), show top 3 possible matches and ask user to confirm before continuing.
    * If the user query is vague (e.g. “ono pivo što volim”), politely ask for clarification or suggest likely results.
    `;

  constructor() {
    // IMPORTANT: The API key is sourced from environment variables for security.
    // Do not hardcode the API key in the application.
    if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable not set.");
    }
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async * generateResponseStream(prompt: string, imageBase64?: string): AsyncGenerator<GenerateContentResponse> {
    try {
        const contents = [];
        const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [{ text: prompt }];

        if (imageBase64) {
            parts.unshift({
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: imageBase64,
                },
            });
        }
        contents.push({ role: 'user', parts });

        const responseStream = await this.ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: {
                systemInstruction: this.systemPrompt,
                tools: [{ googleSearch: {} }],
            }
        });

        for await (const chunk of responseStream) {
            yield chunk;
        }

    } catch (error) {
        console.error('Error calling Gemini API:', error);
        throw new Error('Došlo je do pogreške prilikom dohvaćanja podataka. Pokušajte ponovno.');
    }
  }

  parseResponse(fullResponseText: string, finalResponse: GenerateContentResponse): ChatPart[] {
    const groundingChunks = finalResponse.candidates?.[0]?.groundingMetadata?.groundingChunks;
    const webUris = groundingChunks
        ?.map(chunk => chunk.web)
        .filter(web => web && web.uri && web.title) as {uri: string, title: string}[];

    const parts: ChatPart[] = [];
    
    const drinkHeaderRegex = /_*\*_*\s*Gdje popiti\s*_*\*_*/i;
    const buyHeaderRegex = /_*\*_*\s*Gdje kupiti\s*_*\*_*/i;
    const disclaimerRegex = /Cijene su procjene/i;
    
    const drinkMatch = fullResponseText.match(drinkHeaderRegex);
    const buyMatch = fullResponseText.match(buyHeaderRegex);
    const disclaimerMatch = fullResponseText.match(disclaimerRegex);

    // 1. Extract Summary
    let summaryEndIndex = [drinkMatch?.index, buyMatch?.index, disclaimerMatch?.index]
        .filter((i): i is number => i !== undefined)
        .reduce((min, curr) => Math.min(min, curr), Infinity);
    if (summaryEndIndex === Infinity) summaryEndIndex = fullResponseText.length;
    
    const summary = fullResponseText.substring(0, summaryEndIndex).trim();
    if (summary) {
        parts.push({ type: 'text', content: summary });
    }

    // 2. Extract "Gdje popiti" section
    if (drinkMatch) {
        const sectionStartIndex = drinkMatch.index! + drinkMatch[0].length;
        
        const nextSectionIndex = [buyMatch?.index, disclaimerMatch?.index]
            .filter((i): i is number => i !== undefined && i > drinkMatch!.index!)
            .reduce((min, curr) => Math.min(min, curr), Infinity);

        const sectionEndIndex = nextSectionIndex === Infinity ? fullResponseText.length : nextSectionIndex;
        
        const drinkSectionText = fullResponseText.substring(sectionStartIndex, sectionEndIndex).trim();
        const places = this._parsePlaces(drinkSectionText, webUris);
        if (places.length > 0) {
            parts.push({ type: 'locations', title: 'Gdje popiti', places });
        }
    }
    
    // 3. Extract "Gdje kupiti" section
    if (buyMatch) {
        const sectionStartIndex = buyMatch.index! + buyMatch[0].length;
        
        const nextSectionIndex = [disclaimerMatch?.index]
             .filter((i): i is number => i !== undefined && i > buyMatch!.index!)
            .reduce((min, curr) => Math.min(min, curr), Infinity);

        const sectionEndIndex = nextSectionIndex === Infinity ? fullResponseText.length : nextSectionIndex;
        
        const buySectionText = fullResponseText.substring(sectionStartIndex, sectionEndIndex).trim();
        const places = this._parsePlaces(buySectionText, webUris);
        if (places.length > 0) {
            parts.push({ type: 'locations', title: 'Gdje kupiti', places });
        }
    }

    // 4. Extract Disclaimer
    if (disclaimerMatch) {
        const disclaimerText = fullResponseText.substring(disclaimerMatch.index!).trim();
        if (disclaimerText) {
            parts.push({ type: 'text', content: disclaimerText });
        }
    }

    // Fallback if nothing was parsed
    if (parts.length === 0 && fullResponseText.trim()) {
        return [{ type: 'text', content: fullResponseText.trim() }];
    }

    return parts.filter(p => {
        if (p.type === 'text' && !p.content) return false;
        if (p.type === 'locations' && p.places.length === 0) return false;
        return true;
    });
  }

  private _parsePlaces(sectionText: string, uris?: {uri: string, title: string}[]): Place[] {
    // Split by one or more newlines, making it robust to different list formats.
    const placeBlocks = sectionText.trim().split(/\n\s*\n+/).filter(Boolean);
    
    return placeBlocks.map(block => {
        const lines = block.trim().split('\n').map(l => l.trim());
        const place: Place = { name: 'N/A', expanded: false };
        
        if (lines.length > 0) {
            // Remove markdown list markers like "1." or "*" from the first line.
            const firstLine = lines[0].replace(/^\d+\.\s*|^\*\s*/, '').trim();
            
            const nameMatch = firstLine.match(/^(.+?)\s*(—|-)/); // Accept em-dash or hyphen
            // Clean bolding markers from name
            place.name = nameMatch ? nameMatch[1].trim().replace(/\*+/g, '') : firstLine.replace(/\*+/g, '');
            
            // Try to find a map link from grounding chunks
            if (uris && place.name !== 'N/A') {
                const placeNameLower = place.name.toLowerCase();
                const matchedUri = uris.find(uri => 
                    uri.title?.toLowerCase().includes(placeNameLower) || 
                    placeNameLower.includes(uri.title?.toLowerCase() ?? '')
                );
                if (matchedUri) {
                    place.mapLink = matchedUri.uri;
                }
            }
            
            const ratingMatch = firstLine.match(/★(\d[\.,]\d)\s*\((\d+)/);
            if(ratingMatch) {
                place.rating = ratingMatch[1];
                place.reviews = ratingMatch[2];
            }
            
            const distanceMatch = firstLine.match(/(—|-)\s*([\d\.,]+\s*k?m)$/i); // Accept em-dash or hyphen, case-insensitive
            if (distanceMatch) {
                place.distance = distanceMatch[2];
            }
        }
        
        lines.slice(1).forEach(line => {
            if (line.toLowerCase().startsWith('adresa:')) {
                const parts = line.split(/—|-/).map(p => p.trim()); // Accept em-dash or hyphen
                place.address = parts[0].replace(/adresa:/i, '').trim();
                if (parts.length > 1) {
                    place.hours = parts[1].replace(/radno vrijeme:/i, '').trim();
                }
            } else if (line.toLowerCase().startsWith('radno vrijeme:')) {
                 place.hours = line.replace(/radno vrijeme:/i, '').trim();
            } else if (line.toLowerCase().startsWith('procjena cijene:')) {
                place.price = line.replace(/procjena cijene:/i, '').trim();
            } else if (line.includes('[Google Maps link]')) {
                 if (!place.mapLink) place.mapLink = '#';
            } else if (line) {
                place.quote = (place.quote ? place.quote + ' ' : '') + line.replace(/^\*+|\*+$/g, '');
            }
        });

        if(place.quote) {
             place.quote = place.quote.replace(/^\'|\'$/g, '').replace(/^\"|\"$/g, '');
        }

        return place;
    }).filter(p => p.name !== 'N/A' && p.name.trim() !== '');
  }
}