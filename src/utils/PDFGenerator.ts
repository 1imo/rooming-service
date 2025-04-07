// Final version of PDFGenerator with layout stability + multi-room scaling logic
import puppeteer from 'puppeteer';
import os from 'os';

export class PDFGenerator {
    private readonly apiUrl: string;
    private readonly maxRetries: number = 3;
    private readonly retryDelay: number = 1000;

    constructor() {
        this.apiUrl = process.env.ROOMING_SERVICE_URL || 'http://localhost:3011';
    }

    private getChromePath(): string {
        if (process.env.CHROME_BIN) return process.env.CHROME_BIN;

        const platform = os.platform();
        if (platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

        const linuxPaths = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'];
        for (const path of linuxPaths) {
            try {
                if (require('fs').existsSync(path)) return path;
            } catch (_) {}
        }
        return linuxPaths[0];
    }

    async generate(companyId: string, customerId: string, roomName?: string): Promise<Buffer> {
        let browser = null;
        const executablePath = this.getChromePath();

        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                browser = await puppeteer.launch({
                    headless: 'new',
                    executablePath,
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
                });

                const page = await browser.newPage();
                await page.setViewport({ width: 1123, height: 794, deviceScaleFactor: 1 });

                const url = roomName
                    ? `${this.apiUrl}/floorplan/${companyId}/${customerId}/${roomName}?print=true`
                    : `${this.apiUrl}/floorplan/${companyId}/${customerId}?print=true`;

                await page.goto(url, {
                    waitUntil: ['networkidle0', 'load', 'domcontentloaded'],
                    timeout: 30000
                });

                await page.emulateMediaType('screen');
                await page.evaluateHandle('document.fonts.ready');

                // Apply stable layout styles
                await page.evaluate(() => {
                    document.body.style.margin = '0';
                    document.body.style.padding = '0';
                    document.body.style.background = 'white';
                    document.body.style.minHeight = '210mm';
                    document.body.style.display = 'block';

                    document.querySelectorAll('.page').forEach(page => {
                        const el = page as HTMLElement;
                        el.style.width = '1123px';
                        el.style.height = '794px';
                        el.style.pageBreakAfter = 'always';
                        el.style.overflow = 'hidden';
                        el.style.margin = '0 auto';
                        el.style.position = 'relative';
                    });

                    document.querySelectorAll('.floorplan-container').forEach(container => {
                        const el = container as HTMLElement;
                        el.style.display = 'flex';
                        el.style.justifyContent = 'center';
                        el.style.alignItems = 'center';
                        el.style.width = '1063px';
                        el.style.height = '560px';
                        el.style.margin = '0 30px';
                        el.style.padding = '20px 0';
                        el.style.position = 'relative';
                        el.style.overflow = 'visible';
                    });

                    document.querySelectorAll('.rooms-wrapper').forEach(wrapper => {
                        const el = wrapper as HTMLElement;
                        el.style.position = 'relative';
                        el.style.width = '100%';
                        el.style.height = '100%';
                        el.style.border = '1px solid #e0e0e0';
                        el.style.display = 'block';
                    });

                    document.querySelectorAll('.room').forEach(room => {
                        const el = room as HTMLElement;
                        el.style.position = 'absolute';
                        el.style.left = '50%';
                        el.style.top = '50%';
                        el.style.transform = 'translate(-50%, -50%)';
                        el.style.width = '100%';
                        el.style.height = '100%';
                    });
                });

                // Position & scale SVGs
                await page.evaluate(() => {
                    const TEXT_OFFSET = -15;
                    const ROOM_PADDING = 40;

                    document.querySelectorAll('.rooms-wrapper').forEach(wrapper => {
                        const rooms = wrapper.querySelectorAll('.room');
                        if (!rooms.length) return;

                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

                        rooms.forEach(room => {
                            const svg = room.querySelector('svg');
                            const path = svg?.querySelector('path');
                            const d = path?.getAttribute('d') ?? '';

                            const points = d.match(/[ML] ([-\d.]+) ([-\d.]+)/g)?.map(p => {
                                const [x, y] = p.slice(2).split(' ').map(Number);
                                return { x, y };
                            }) ?? [];

                            points.forEach(({ x, y }) => {
                                minX = Math.min(minX, x);
                                minY = Math.min(minY, y);
                                maxX = Math.max(maxX, x);
                                maxY = Math.max(maxY, y);
                            });
                        });

                        const totalWidth = maxX - minX;
                        const totalHeight = maxY - minY;
                        const centerX = minX + totalWidth / 2;
                        const centerY = minY + totalHeight / 2;

                        const wrapperRect = (wrapper as HTMLElement).getBoundingClientRect();
                        const availableWidth = wrapperRect.width - ROOM_PADDING * 2;
                        const availableHeight = wrapperRect.height - ROOM_PADDING * 2;
                        const scale = Math.min(availableWidth / totalWidth, availableHeight / totalHeight) * 0.85;

                        rooms.forEach(room => {
                            const svg = room.querySelector('svg');
                            const path = svg?.querySelector('path');
                            if (!path) return;

                            const transformPath = (d: string) =>
                                d.replace(/([ML]) ([-\d.]+) ([-\d.]+)/g, (match, cmd, x, y) => {
                                    const newX = (parseFloat(x) - centerX) * scale;
                                    const newY = (parseFloat(y) - centerY) * scale;
                                    return `${cmd} ${newX} ${newY}`;
                                });

                            const newD = transformPath(path.getAttribute('d') || '');
                            path.setAttribute('d', newD);

                            const viewBoxWidth = totalWidth * scale;
                            const viewBoxHeight = totalHeight * scale;
                            svg?.setAttribute('viewBox', `${-viewBoxWidth/2} ${-viewBoxHeight/2} ${viewBoxWidth} ${viewBoxHeight}`);

                            const label = room.querySelector('.room-label');
                            if (label) {
                                const x = parseFloat(label.getAttribute('x') || '0');
                                const y = parseFloat(label.getAttribute('y') || '0');
                                label.setAttribute('x', ((x - centerX) * scale).toString());
                                label.setAttribute('y', ((y - centerY) * scale).toString());
                            }

                            room.querySelectorAll('.room-measurement').forEach(measurement => {
                                const x = parseFloat(measurement.getAttribute('x') || '0');
                                const y = parseFloat(measurement.getAttribute('y') || '0');
                                const angle = parseFloat(measurement.getAttribute('transform')?.match(/rotate\(([-\d.]+)/)?.[1] || '0');

                                const newX = (x - centerX) * scale;
                                const newY = (y - centerY) * scale;
                                const offsetX = newX + Math.cos((angle + 90) * Math.PI / 180) * TEXT_OFFSET;
                                const offsetY = newY + Math.sin((angle + 90) * Math.PI / 180) * TEXT_OFFSET;

                                measurement.setAttribute('x', offsetX.toString());
                                measurement.setAttribute('y', offsetY.toString());
                                measurement.setAttribute('transform', `rotate(${angle} ${offsetX} ${offsetY})`);
                            });
                        });
                    });
                });

                await page.waitForTimeout(1000);

                const pdfBuffer = await page.pdf({
                    width: '297mm',
                    height: '210mm',
                    printBackground: true,
                    margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
                    preferCSSPageSize: true,
                    displayHeaderFooter: false
                });

                return Buffer.from(pdfBuffer);
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                if (attempt === this.maxRetries - 1) throw new Error(`Failed to generate PDF: ${errorMessage}`);
                await new Promise(res => setTimeout(res, this.retryDelay));
            } finally {
                if (browser) await browser.close();
            }
        }

        throw new Error('Unreachable code after retry loop.');
    }
}
