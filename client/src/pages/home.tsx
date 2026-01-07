import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Settings } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="text-4xl">🚢</span>
            <CardTitle className="text-3xl font-mono">BATTLE DINGHY</CardTitle>
            <span className="text-4xl">⚓</span>
          </div>
          <CardDescription className="text-lg">
            A Twitter-native Battleship elimination game powered by Solana & ORE mining
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <h3 className="font-semibold text-lg">How It Works</h3>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <Badge variant="outline" className="shrink-0">1</Badge>
                <span>Follow <span className="font-mono text-foreground">@battle_dinghy</span> on Twitter for game announcements</span>
              </li>
              <li className="flex gap-2">
                <Badge variant="outline" className="shrink-0">2</Badge>
                <span>Pay entry fee via Solana Blink embedded in tweet (one-click payment)</span>
              </li>
              <li className="flex gap-2">
                <Badge variant="outline" className="shrink-0">3</Badge>
                <span>Receive your randomized 5×5 board via @mention in the game thread</span>
              </li>
              <li className="flex gap-2">
                <Badge variant="outline" className="shrink-0">4</Badge>
                <span>ORE mining generates 25 random coordinates fired at all players simultaneously</span>
              </li>
              <li className="flex gap-2">
                <Badge variant="outline" className="shrink-0">5</Badge>
                <span>Last player with unsunk ships wins the prize pool + mined ORE!</span>
              </li>
            </ol>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Players per Game</div>
              <div className="text-2xl font-bold text-primary">35-50</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Game Duration</div>
              <div className="text-2xl font-bold text-primary">~25 min</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Your Fleet</div>
              <div className="text-sm font-mono">
                <div>🔵 Big Dinghy (3 HP)</div>
                <div>🔵 Dinghy (2 HP)</div>
                <div>🔵 Small Dinghy (1 HP)</div>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Randomness</div>
              <div className="text-sm">
                <Badge variant="secondary">Provably Fair</Badge>
                <div className="text-xs text-muted-foreground mt-1">ORE Protocol</div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              All gameplay happens on Twitter's public timeline
            </p>
            <Link href="/admin">
              <Button variant="outline" size="sm" data-testid="button-admin">
                <Settings className="w-4 h-4 mr-2" />
                Admin Panel
              </Button>
            </Link>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <span>Bot:</span>
              <span className="font-mono text-foreground">@battle_dinghy</span>
              <span>|</span>
              <span>API:</span>
              <span className="font-mono text-foreground">@thejustinfagan</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
