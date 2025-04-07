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

                // Apply layout and page formatting
                await page.evaluate(() => {
                    document.documentElement.style.background = 'white';

                    document.body.style.margin = '0';
                    document.body.style.padding = '0';
                    document.body.style.background = 'white';
                    document.body.style.minHeight = '210mm';
                    document.body.style.display = 'block';
                    document.body.style.boxShadow = 'none';

                    const pages = document.querySelectorAll('.page');
                    pages.forEach((page, i) => {
                        const el = page as HTMLElement;
                        el.style.width = '297mm';
                        el.style.height = '210mm';
                        el.style.pageBreakAfter = (i === pages.length - 1) ? 'auto' : 'always';
                        el.style.margin = '0';
                        el.style.padding = '0';
                        el.style.overflow = 'hidden';
                        el.style.position = 'relative';
                        el.style.background = 'white';
                        el.style.boxShadow = 'none';
                        el.style.border = 'none';
                    });

                    document.querySelectorAll('.floorplan-container').forEach(container => {
                        const el = container as HTMLElement;
                        el.style.display = 'flex';
                        el.style.justifyContent = 'center';
                        el.style.alignItems = 'flex-start';
                        el.style.width = '1063px';
                        el.style.height = 'calc(100% - 200px)';
                        el.style.margin = '0 30px';
                        el.style.padding = '20px 0';
                        el.style.position = 'relative';
                        el.style.overflow = 'visible';
                        el.style.background = 'white';
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
                        el.style.top = '0';
                        el.style.left = '50%';
                        el.style.transform = 'translateX(-50%)';
                        el.style.width = '100%';
                        el.style.height = '100%';
                    });
                });

                // Prepass to compute global min/max bounds across all rooms
                const globalBounds = await page.evaluate(() => {
                    const allBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

                    document.querySelectorAll('.rooms-wrapper .room').forEach(room => {
                        const svg = room.querySelector('svg');
                        const path = svg?.querySelector('path');
                        const d = path?.getAttribute('d') ?? '';

                        const points = d.match(/[ML] ([-\d.]+) ([-\d.]+)/g)?.map(p => {
                            const [x, y] = p.slice(2).split(' ').map(Number);
                            return { x, y };
                        }) ?? [];

                        points.forEach(({ x, y }) => {
                            allBounds.minX = Math.min(allBounds.minX, x);
                            allBounds.minY = Math.min(allBounds.minY, y);
                            allBounds.maxX = Math.max(allBounds.maxX, x);
                            allBounds.maxY = Math.max(allBounds.maxY, y);
                        });

                        const labels = room.querySelectorAll('.room-label, .room-measurement');
                        labels.forEach(el => {
                            const x = parseFloat(el.getAttribute('x') || '0');
                            const y = parseFloat(el.getAttribute('y') || '0');
                            allBounds.minX = Math.min(allBounds.minX, x);
                            allBounds.minY = Math.min(allBounds.minY, y);
                            allBounds.maxX = Math.max(allBounds.maxX, x);
                            allBounds.maxY = Math.max(allBounds.maxY, y);
                        });
                    });

                    return allBounds;
                });

                // Apply uniform scaling using the shared bounds
                await page.evaluate(({ minX, minY, maxX, maxY }) => {
                    const TEXT_OFFSET = -15;
                    const totalWidth = maxX - minX;
                    const totalHeight = maxY - minY;
                    const centerX = minX + totalWidth / 2;
                    const centerY = minY + totalHeight / 2;

                    document.querySelectorAll('.rooms-wrapper').forEach(wrapper => {
                        const wrapperRect = (wrapper as HTMLElement).getBoundingClientRect();
                        const availableWidth = wrapperRect.width;
                        const availableHeight = wrapperRect.height;
                        const scale = Math.min(availableWidth / totalWidth, availableHeight / totalHeight) * 0.95;

                        wrapper.querySelectorAll('.room').forEach(room => {
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
                            svg?.setAttribute('viewBox', `${-viewBoxWidth / 2} ${-viewBoxHeight / 2} ${viewBoxWidth} ${viewBoxHeight}`);

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
                }, globalBounds);

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
                const err = error instanceof Error ? error : new Error(String(error));
                if (attempt === this.maxRetries - 1) throw new Error(`Failed to generate PDF: ${err.message}`);
                await new Promise(res => setTimeout(res, this.retryDelay));
            } finally {
                if (browser) await browser.close();
            }
        }

        throw new Error('Unreachable code after retry loop.');
    }
}
