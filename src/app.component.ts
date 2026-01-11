import { Component, ChangeDetectionStrategy, signal, OnInit, OnDestroy, ElementRef, ViewChild, afterNextRender, inject, Injector } from '@angular/core';
import { CommonModule } from '@angular/common';

type GameStatus = 'start' | 'playing' | 'level-complete' | 'game-complete' | 'game-over';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: [],
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:keydown)': 'handleKeydown($event)',
  }
})
export class AppComponent implements OnInit, OnDestroy {
  @ViewChild('levelCompleteSound') levelCompleteSoundRef!: ElementRef<HTMLAudioElement>;
  @ViewChild('backgroundMusic') backgroundMusicRef!: ElementRef<HTMLAudioElement>;
  @ViewChild('infiniteMusic') infiniteMusicRef!: ElementRef<HTMLAudioElement>;
  @ViewChild('gameCompleteMusic') gameCompleteMusicRef!: ElementRef<HTMLAudioElement>;
  @ViewChild('mazeContainer') mazeContainerRef!: ElementRef<HTMLDivElement>;

  level = signal(1);
  score = signal(0);
  timer = signal(0);
  gameStatus = signal<GameStatus>('start');
  isMuted = signal(true);
  showMinimap = signal(false);
  canTeleport = signal(true);
  
  maze = signal<string[][]>([]);
  playerPosition = signal({ x: 0, y: 0 });
  enemies = signal<{ x: number, y: number }[]>([]);
  stalkers = signal<{ x: number, y: number }[]>([]);
  playerHit = signal(false);
  regenerateIconPositions = signal<{ x: number, y: number }[]>([]);
  teleporterPositions = signal<{x: number, y: number}[]>([]);

  wallColor = signal('');
  pathColor = signal('');
  
  private timerInterval: any;
  private enemyInterval: any;
  private stalkersInterval: any;
  private startPosition = { x: 1, y: 1 };
  private injector = inject(Injector);
  private nextLevelTimeout: any;
  private scrollAnimationId: number | null = null;

  constructor() {
    afterNextRender(() => {
        // Set initial muted state after view is initialized.
        // This prevents audio from auto-playing on load.
        this.updateMuteState();
    });
  }

  ngOnInit(): void {}

  ngOnDestroy(): void {
    clearInterval(this.timerInterval);
    this.stopEnemyMovement();
    this.stopStalkerMovement();
    clearTimeout(this.nextLevelTimeout);
    if (this.scrollAnimationId) {
      cancelAnimationFrame(this.scrollAnimationId);
    }
  }

  get mazeWidth(): number {
    return this.maze()[0]?.length || 0;
  }
  
  get mazeHeight(): number {
    return this.maze().length;
  }

  private requestFullScreen(): void {
    const elem = document.documentElement as any;
    if (elem.requestFullscreen) {
      elem.requestFullscreen();
    } else if (elem.mozRequestFullScreen) { /* Firefox */
      elem.mozRequestFullScreen();
    } else if (elem.webkitRequestFullscreen) { /* Chrome, Safari & Opera */
      elem.webkitRequestFullscreen();
    } else if (elem.msRequestFullscreen) { /* IE/Edge */
      elem.msRequestFullscreen();
    }
  }

  startGame(): void {
    // Request fullscreen on mobile/touch devices for a more immersive experience
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        this.requestFullScreen();
    }
    
    this.score.set(0);
    this.level.set(1);
    this.loadLevel(this.level());
    this.gameStatus.set('playing');
    this.startTimer();
    this.startEnemyMovement();
    this.startStalkerMovement();

    // Unmute and play music on game start
    this.isMuted.set(false);
    this.updateMuteState();
    this.playCorrectMusic();
  }

  loadNextLevel(): void {
    this.gameStatus.set('level-complete');
    this.stopTimer();
    this.stopEnemyMovement();
    this.stopStalkerMovement();

    clearTimeout(this.nextLevelTimeout);
    this.nextLevelTimeout = setTimeout(() => {
      this.level.update(l => l + 1);
      this.loadLevel(this.level());
      this.gameStatus.set('playing');
      this.startTimer();
      this.startEnemyMovement();
      this.startStalkerMovement();
    }, 2000);
  }

  skipLevels(): void {
    if (this.gameStatus() !== 'playing') return;

    // Prevent skipping level 29, so the user must play level 30 to see the end screen.
    if (this.level() === 29) return;

    clearTimeout(this.nextLevelTimeout);
    this.stopTimer();
    this.stopEnemyMovement();
    this.stopStalkerMovement();

    this.level.update(l => l + 1);
    this.loadLevel(this.level());

    this.startTimer();
    this.startEnemyMovement();
    this.startStalkerMovement();
  }

  continueToInfinite(): void {
    this.level.update(l => l + 1);
    this.loadLevel(this.level());
    this.gameStatus.set('playing');
    this.startTimer();
    this.startEnemyMovement();
    this.startStalkerMovement();
  }

  restartGame(): void {
    this.stopAllMusic();
    this.gameStatus.set('start');
    this.isMuted.set(true);
    this.updateMuteState();
  }

  private randomizeColors(): void {
    const colorSchemes = [
      { wall: 'bg-gray-800 border-gray-900', path: 'bg-slate-700' },
      { wall: 'bg-sky-900 border-sky-950', path: 'bg-sky-800' },
      { wall: 'bg-indigo-900 border-indigo-950', path: 'bg-indigo-800' },
      { wall: 'bg-purple-900 border-purple-950', path: 'bg-purple-800' },
      { wall: 'bg-stone-800 border-stone-900', path: 'bg-stone-700' },
      { wall: 'bg-emerald-900 border-emerald-950', path: 'bg-emerald-800' },
      { wall: 'bg-teal-900 border-teal-950', path: 'bg-teal-800' },
      { wall: 'bg-lime-900 border-lime-950', path: 'bg-lime-800' },
      { wall: 'bg-amber-800 border-amber-900', path: 'bg-amber-700' },
      { wall: 'bg-pink-900 border-pink-950', path: 'bg-pink-800' },
      { wall: 'bg-rose-900 border-rose-950', path: 'bg-rose-800' },
      { wall: 'bg-cyan-900 border-cyan-950', path: 'bg-cyan-800' },
    ];
    
    const randomIndex = Math.floor(Math.random() * colorSchemes.length);
    const scheme = colorSchemes[randomIndex];
    
    this.wallColor.set(scheme.wall);
    this.pathColor.set(scheme.path);
  }

  private generateMaze(level: number): string[][] {
    const sizeLevel = Math.min(level, 30);
    const size = 7 + (sizeLevel - 1) * 2;
    const maze: string[][] = Array(size).fill(null).map(() => Array(size).fill('W'));

    const carve = (cx: number, cy: number) => {
        maze[cy][cx] = ' ';
        const directions: [number, number][] = [[0, -2], [0, 2], [-2, 0], [2, 0]];
        for (let i = directions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [directions[i], directions[j]] = [directions[j], directions[i]];
        }
        for (const [dx, dy] of directions) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (ny > 0 && ny < size - 1 && nx > 0 && nx < size - 1 && maze[ny][nx] === 'W') {
                maze[ny - dy / 2][nx - dx / 2] = ' ';
                carve(nx, ny);
            }
        }
    };

    carve(1, 1);

    // Increase complexity by removing more walls on higher levels
    const removalIterations = Math.floor(size * level * 0.2);
    for (let i = 0; i < removalIterations; i++) {
        const rx = Math.floor(Math.random() * (size - 2)) + 1;
        const ry = Math.floor(Math.random() * (size - 2)) + 1;
        if (maze[ry][rx] === 'W') {
            const isHorizontalWall = rx > 0 && rx < size - 1 && maze[ry][rx - 1] !== 'W' && maze[ry][rx + 1] !== 'W';
            const isVerticalWall = ry > 0 && ry < size - 1 && maze[ry - 1][rx] !== 'W' && maze[ry + 1][rx] !== 'W';
            if (isHorizontalWall || isVerticalWall) maze[ry][rx] = ' ';
        }
    }

    maze[1][1] = 'S';
    maze[size - 2][size - 2] = 'E';
    return maze;
  }

  loadLevel(level: number): void {
    this.randomizeColors();
    const levelData = this.generateMaze(level);
    this.maze.set(levelData);
    this.canTeleport.set(true);

    for (let y = 0; y < levelData.length; y++) {
      for (let x = 0; x < levelData[y].length; x++) {
        if (levelData[y][x] === 'S') {
          this.startPosition = { x, y };
          this.playerPosition.set({ ...this.startPosition });
          this.spawnEnemies(level, levelData);
          this.spawnRegenerateIcons(level, levelData);
          this.spawnTeleporters(level, levelData);
          this.spawnStalkers(level, levelData);
          this.scrollToPlayer();
          this.playCorrectMusic();
          return;
        }
      }
    }
  }
  
  spawnEnemies(level: number, maze: string[][]): void {
    if (level < 15) {
      this.enemies.set([]);
      return;
    }
    const newEnemies: {x: number, y: number}[] = [];
    const enemyCount = Math.min(4, Math.floor((level - 15) / 2) + 1);
    
    const pathCells: {x: number, y: number}[] = [];
    for (let y = 0; y < maze.length; y++) {
        for (let x = 0; x < maze[y].length; x++) {
            const isPath = maze[y][x] === ' ';
            const distFromStart = Math.abs(x - this.startPosition.x) + Math.abs(y - this.startPosition.y);
            if (isPath && distFromStart > 5) {
                pathCells.push({x, y});
            }
        }
    }

    for (let i = 0; i < enemyCount && pathCells.length > 0; i++) {
        const randIndex = Math.floor(Math.random() * pathCells.length);
        newEnemies.push(pathCells.splice(randIndex, 1)[0]);
    }
    this.enemies.set(newEnemies);
  }

  spawnRegenerateIcons(level: number, maze: string[][]): void {
    if (level < 10) {
        this.regenerateIconPositions.set([]);
        return;
    }

    const newIcons: {x: number, y: number}[] = [];
    const count = (Math.random() < 0.5 ? 2 : 3) + 2;
    const pathCells: {x: number, y: number}[] = [];
    const size = maze.length;
    const exitPos = { x: size - 2, y: size - 2 };

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const isPath = maze[y][x] === ' ';
            const distFromStart = Math.abs(x - this.startPosition.x) + Math.abs(y - this.startPosition.y);
            const distFromExit = Math.abs(x - exitPos.x) + Math.abs(y - exitPos.y);

            if (isPath && distFromStart > 8 && distFromExit > 8) {
                pathCells.push({x, y});
            }
        }
    }

    for (let i = 0; i < count && pathCells.length > 0; i++) {
        const randIndex = Math.floor(Math.random() * pathCells.length);
        newIcons.push(pathCells.splice(randIndex, 1)[0]);
    }
    this.regenerateIconPositions.set(newIcons);
  }

  spawnTeleporters(level: number, maze: string[][]): void {
    if (level < 20) {
      this.teleporterPositions.set([]);
      return;
    }

    const newTeleporters: {x: number, y: number}[] = [];
    const count = Math.min(14, 2 + Math.floor((level - 20) / 4) * 2);
    const pathCells: {x: number, y: number}[] = [];
    const size = maze.length;
    const exitPos = { x: size - 2, y: size - 2 };
    const regenPositions = this.regenerateIconPositions();

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const isPath = maze[y][x] === ' ';
        const isNotStart = !(x === this.startPosition.x && y === this.startPosition.y);
        const isNotExit = !(x === exitPos.x && y === exitPos.y);
        const isNotRegenIcon = !regenPositions.some(p => p.x === x && p.y === y);

        if (isPath && isNotStart && isNotExit && isNotRegenIcon) {
          pathCells.push({x, y});
        }
      }
    }

    for (let i = 0; i < count && pathCells.length > 0; i++) {
        const randIndex = Math.floor(Math.random() * pathCells.length);
        newTeleporters.push(pathCells.splice(randIndex, 1)[0]);
    }
    this.teleporterPositions.set(newTeleporters);
  }

  spawnStalkers(level: number, maze: string[][]): void {
    if (level < 25) {
      this.stalkers.set([]);
      return;
    }
    
    const stalkerCount = 1;
    const newStalkers: {x: number, y: number}[] = [];
    const pathCells: {x: number, y: number}[] = [];
    const size = maze.length;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const isPath = maze[y][x] === ' ';
        const distFromStart = Math.abs(x - this.startPosition.x) + Math.abs(y - this.startPosition.y);

        if (isPath && distFromStart > 10) {
          pathCells.push({x, y});
        }
      }
    }

    for (let i = 0; i < stalkerCount && pathCells.length > 0; i++) {
      const randIndex = Math.floor(Math.random() * pathCells.length);
      newStalkers.push(pathCells.splice(randIndex, 1)[0]);
    }
    this.stalkers.set(newStalkers);
  }
  
  startEnemyMovement(): void {
    this.stopEnemyMovement();
    const speed = Math.max(300, 800 - ((this.level() - 10) * 10));
    this.enemyInterval = setInterval(() => this.moveEnemies(), speed);
  }

  stopEnemyMovement(): void {
    if (this.enemyInterval) clearInterval(this.enemyInterval);
  }

  startStalkerMovement(): void {
    this.stopStalkerMovement();
    if (this.level() < 25) return;
    const speed = Math.max(400, 900 - ((this.level() - 10) * 10));
    this.stalkersInterval = setInterval(() => this.moveStalkers(), speed);
  }

  stopStalkerMovement(): void {
    if (this.stalkersInterval) clearInterval(this.stalkersInterval);
  }

  moveEnemies(): void {
    const currentMaze = this.maze();
    const playerPos = this.playerPosition();
    const newEnemyPositions = this.enemies().map(enemy => {
        const { x, y } = enemy;

        const dx = playerPos.x - x;
        const dy = playerPos.y - y;

        const possibleMoves: {x: number, y: number, priority: number}[] = [];
        const directions: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]]; 

        for (const [mdx, mdy] of directions) {
            const newX = x + mdx;
            const newY = y + mdy;
            if (newY >= 0 && newY < currentMaze.length && newX >= 0 && newX < currentMaze[newY].length && currentMaze[newY][newX] !== 'W') {
                let priority = 0;
                if (Math.abs(dx) > Math.abs(dy)) { 
                    if (mdx !== 0 && Math.sign(mdx) === Math.sign(dx)) priority = 2;
                    else if (mdy !== 0 && Math.sign(mdy) === Math.sign(dy)) priority = 1;
                } else {
                    if (mdy !== 0 && Math.sign(mdy) === Math.sign(dy)) priority = 2;
                    else if (mdx !== 0 && Math.sign(mdx) === Math.sign(dx)) priority = 1;
                }
                possibleMoves.push({ x: newX, y: newY, priority });
            }
        }
        
        if (possibleMoves.length === 0) return enemy;

        possibleMoves.sort((a, b) => b.priority - a.priority);
        const bestPriority = possibleMoves[0].priority;
        const bestMoves = possibleMoves.filter(m => m.priority === bestPriority);
        const chosenMove = bestMoves[Math.floor(Math.random() * bestMoves.length)];

        return { x: chosenMove.x, y: chosenMove.y };
    });

    this.enemies.set(newEnemyPositions);
    this.checkGameState();
  }

  moveStalkers(): void {
    const currentStalkers = this.stalkers();
    if (currentStalkers.length === 0) return;

    const player = this.playerPosition();
    const maze = this.maze();

    const newStalkerPositions = currentStalkers.map(stalker => {
        const start = stalker;
        const end = player;

        const queue: { x: number; y: number; path: { x: number; y: number }[] }[] = [
            { x: start.x, y: start.y, path: [start] },
        ];
        const visited = new Set<string>([`${start.y},${start.x}`]);
        let foundPath: { x: number; y: number }[] | null = null;

        while (queue.length > 0) {
            const { x, y, path } = queue.shift()!;

            if (x === end.x && y === end.y) {
                foundPath = path;
                break;
            }

            const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]]; // Down, Up, Right, Left
            for (const [dx, dy] of directions) {
                const newX = x + dx;
                const newY = y + dy;
                const key = `${newY},${newX}`;

                if (
                    newY >= 0 && newY < maze.length &&
                    newX >= 0 && newX < maze[0].length &&
                    maze[newY][newX] !== 'W' &&
                    !visited.has(key)
                ) {
                    visited.add(key);
                    const newPath = [...path, { x: newX, y: newY }];
                    queue.push({ x: newX, y: newY, path: newPath });
                }
            }
        }

        if (foundPath && foundPath.length > 1) {
            return foundPath[1];
        }
        return stalker;
    });
    
    this.stalkers.set(newStalkerPositions);
    this.checkGameState();
  }

  handleKeydown(event: KeyboardEvent): void {
    if (this.gameStatus() !== 'playing') return;
    
    event.preventDefault();
    switch (event.key) {
      case 'ArrowUp': case 'w': this.movePlayer(0, -1); break;
      case 'ArrowDown': case 's': this.movePlayer(0, 1); break;
      case 'ArrowLeft': case 'a': this.movePlayer(-1, 0); break;
      case 'ArrowRight': case 'd': this.movePlayer(1, 0); break;
    }
  }

  movePlayer(dx: number, dy: number): void {
    if (this.gameStatus() !== 'playing' || this.playerHit()) return;
    const currentPos = this.playerPosition();
    const newPos = { x: currentPos.x + dx, y: currentPos.y + dy };

    if (newPos.y >= 0 && newPos.y < this.maze().length && newPos.x >= 0 && newPos.x < this.maze()[newPos.y].length && this.maze()[newPos.y][newPos.x] !== 'W') {
      this.playerPosition.set(newPos);
      
      const isNowOnTeleporter = this.teleporterPositions().some(tp => tp.x === newPos.x && tp.y === newPos.y);
      if (!isNowOnTeleporter) {
          this.canTeleport.set(true);
      }

      this.checkGameState();
      this.scrollToPlayer();
    }
  }

  private regenerateMazeFromPlayerPosition(): void {
    const currentPos = this.playerPosition();
    const newMazeLayout = this.generateMaze(this.level());

    if (newMazeLayout[1][1] === 'S') {
        newMazeLayout[1][1] = ' ';
    }
    if (newMazeLayout[currentPos.y][currentPos.x] === 'W') {
         newMazeLayout[currentPos.y][currentPos.x] = ' ';
    }

    newMazeLayout[currentPos.y][currentPos.x] = 'S';

    this.maze.set(newMazeLayout);
    this.startPosition = { ...currentPos };
    
    this.spawnEnemies(this.level(), newMazeLayout);
    this.spawnRegenerateIcons(this.level(), newMazeLayout);
    this.spawnTeleporters(this.level(), newMazeLayout);
    this.spawnStalkers(this.level(), newMazeLayout);
    this.scrollToPlayer();
  }

  checkGameState(): void {
    const pos = this.playerPosition();
    if (this.gameStatus() !== 'playing' || this.playerHit()) return;

    for (const stalker of this.stalkers()) {
      if (pos.x === stalker.x && pos.y === stalker.y) {
        this.gameStatus.set('game-over');
        this.stopTimer();
        this.stopEnemyMovement();
        this.stopStalkerMovement();
        this.stopAllMusic();
        if (!this.isMuted()) {
          this.gameCompleteMusicRef.nativeElement.currentTime = 0;
          this.gameCompleteMusicRef.nativeElement.play().catch(e => console.error("Audio play failed:", e));
        }
        return;
      }
    }

    const teleporterPositions = this.teleporterPositions();
    const teleporterIndex = teleporterPositions.findIndex(tp => tp.x === pos.x && tp.y === pos.y);
    if (teleporterIndex !== -1 && this.canTeleport()) {
        this.canTeleport.set(false);
        const destinationIndex = teleporterIndex % 2 === 0 ? teleporterIndex + 1 : teleporterIndex - 1;
        if (destinationIndex >= 0 && destinationIndex < teleporterPositions.length) {
            const destination = teleporterPositions[destinationIndex];
            this.playerPosition.set(destination);
            this.scrollToPlayer();
            return;
        }
    }
    
    const regenIcon = this.regenerateIconPositions().find(r => r.x === pos.x && r.y === pos.y);
    if (regenIcon) {
        this.regenerateMazeFromPlayerPosition();
        return;
    }

    if (this.maze()[pos.y][pos.x] === 'E') {
      if (!this.isMuted()) {
        this.levelCompleteSoundRef.nativeElement.currentTime = 0;
        this.levelCompleteSoundRef.nativeElement.play().catch(e => console.error("Audio play failed:", e));
      }
      const timeBonus = Math.max(0, 1000 - (this.timer() * 10));
      this.score.update(s => s + timeBonus + 500 * this.level());

      if (this.level() === 30) {
        clearTimeout(this.nextLevelTimeout);
        this.gameStatus.set('game-complete');
        this.stopTimer();
        this.stopEnemyMovement();
        this.stopStalkerMovement();
        this.stopAllMusic();
        if (!this.isMuted()) {
          this.gameCompleteMusicRef.nativeElement.currentTime = 0;
          this.gameCompleteMusicRef.nativeElement.play().catch(e => console.error("Audio play failed:", e));
        }
      } else {
        this.loadNextLevel();
      }
      return;
    }
    
    for (const enemy of this.enemies()) {
      if (pos.x === enemy.x && pos.y === enemy.y) {
        this.playerHit.set(true);
        setTimeout(() => {
          this.playerPosition.set({ ...this.startPosition });
          this.playerHit.set(false);
          this.scrollToPlayer();
        }, 400);
        return;
      }
    }
  }

  startTimer(): void {
    this.timer.set(0);
    this.timerInterval = setInterval(() => {
      this.timer.update(t => t + 1);
    }, 1000);
  }

  stopTimer(): void {
    clearInterval(this.timerInterval);
  }

  toggleMute(): void {
    this.isMuted.update(m => !m);
    this.updateMuteState();
    
    if (this.isMuted()) {
      this.stopAllMusic();
    } else {
      if (this.gameStatus() === 'playing') {
        this.playCorrectMusic();
      } else if (this.gameStatus() === 'game-complete' || this.gameStatus() === 'game-over') {
        this.gameCompleteMusicRef.nativeElement.play().catch(e => console.error("Audio play failed:", e));
      }
    }
  }
  
  toggleMinimap(): void {
    this.showMinimap.update(v => !v);
  }

  private playCorrectMusic(): void {
    this.stopAllMusic();
    if (this.isMuted()) return;

    if (this.level() >= 31) {
      this.infiniteMusicRef.nativeElement.play().catch(e => console.error("Audio play failed:", e));
    } else {
      this.backgroundMusicRef.nativeElement.play().catch(e => console.error("Audio play failed:", e));
    }
  }

  private stopAllMusic(): void {
    if (this.backgroundMusicRef?.nativeElement) {
      this.backgroundMusicRef.nativeElement.pause();
    }
    if (this.infiniteMusicRef?.nativeElement) {
      this.infiniteMusicRef.nativeElement.pause();
    }
    if (this.gameCompleteMusicRef?.nativeElement) {
      this.gameCompleteMusicRef.nativeElement.pause();
    }
  }

  private updateMuteState(): void {
      if (this.backgroundMusicRef?.nativeElement) {
        this.backgroundMusicRef.nativeElement.muted = this.isMuted();
      }
      if (this.infiniteMusicRef?.nativeElement) {
        this.infiniteMusicRef.nativeElement.muted = this.isMuted();
      }
      if (this.gameCompleteMusicRef?.nativeElement) {
        this.gameCompleteMusicRef.nativeElement.muted = this.isMuted();
      }
      if (this.levelCompleteSoundRef?.nativeElement) {
        this.levelCompleteSoundRef.nativeElement.muted = this.isMuted();
      }
  }
  
  getCellClass(cell: string, x: number, y: number): string {
    switch (cell) {
      case 'W':
        return this.wallColor();
      case ' ':
      case 'S':
        return this.pathColor();
      case 'E': return 'bg-green-600';
      default: return this.pathColor();
    }
  }

  getMinimapCellClass(cell: string, x: number, y: number): string {
    if (x === this.playerPosition().x && y === this.playerPosition().y) {
        return 'bg-yellow-400 animate-pulse';
    }
    if (this.enemies().some(e => e.x === x && e.y === y)) {
        return 'bg-red-600';
    }
    if (this.stalkers().some(s => s.x === x && s.y === y)) {
        return 'bg-white animate-pulse';
    }
    if (cell === 'E') {
        return 'bg-green-500';
    }
    if (cell === 'W') {
        return 'bg-slate-700/50';
    }
    return 'bg-transparent';
  }

  private scrollToPlayer(): void {
    afterNextRender(() => {
      const pos = this.playerPosition();
      const playerCell = document.getElementById(`cell-${pos.y}-${pos.x}`);
      const container = this.mazeContainerRef?.nativeElement;
      if (playerCell && container) {
        const targetScrollTop = playerCell.offsetTop + (playerCell.offsetHeight / 2) - (container.clientHeight / 2);
        const targetScrollLeft = playerCell.offsetLeft + (playerCell.offsetWidth / 2) - (container.clientWidth / 2);

        if (this.scrollAnimationId) {
            cancelAnimationFrame(this.scrollAnimationId);
        }
        this.smoothScrollTo(container, targetScrollLeft, targetScrollTop, 200);
      }
    }, { injector: this.injector });
  }

  private smoothScrollTo(element: HTMLElement, toX: number, toY: number, duration: number): void {
    const startX = element.scrollLeft;
    const startY = element.scrollTop;
    const changeX = toX - startX;
    const changeY = toY - startY;
    let startTime: number | null = null;

    const animateScroll = (currentTime: number) => {
        if (startTime === null) startTime = currentTime;
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress; // easeInOutQuad

        element.scrollLeft = startX + changeX * ease;
        element.scrollTop = startY + changeY * ease;

        if (elapsed < duration) {
            this.scrollAnimationId = requestAnimationFrame(animateScroll);
        } else {
            this.scrollAnimationId = null;
        }
    };

    this.scrollAnimationId = requestAnimationFrame(animateScroll);
  }

  shareOnFacebook(): void {
    const gameUrl = encodeURIComponent(window.location.href);
    const shareText = encodeURIComponent(`I beat Maze Quest with a score of ${this.score()}! Can you beat my high score?`);
    const url = `https://www.facebook.com/sharer/sharer.php?u=${gameUrl}&quote=${shareText}`;
    window.open(url, '_blank');
  }

  shareOnWhatsApp(): void {
    const gameUrl = window.location.href;
    const shareText = encodeURIComponent(`I beat Maze Quest with a score of ${this.score()}! Can you beat my high score? Play it here: ${gameUrl}`);
    const url = `https://wa.me/?text=${shareText}`;
    window.open(url, '_blank');
  }
}