import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";

type Game = {
  id: string;
  gameNumber: number;
  status: string;
  entryFeeSol: number;
  prizePoolSol: number;
  maxPlayers: number;
  currentPlayers: number;
};

type VerificationResponse = {
  success: boolean;
  token: string;
  twitterHandle: string;
  blinkUrl: string;
};

export default function JoinGame() {
  const { gameId } = useParams<{ gameId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [twitterHandle, setTwitterHandle] = useState("");
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [blinkUrl, setBlinkUrl] = useState<string | null>(null);

  const { data: game, isLoading: gameLoading, error: gameError } = useQuery<Game>({
    queryKey: ["/api/games", gameId],
    queryFn: async () => {
      const response = await fetch(`/api/games/${gameId}`);
      if (!response.ok) {
        throw new Error("Game not found");
      }
      const data = await response.json();
      return data.game;
    },
    enabled: !!gameId,
  });

  const verifyHandleMutation = useMutation({
    mutationFn: async (handle: string) => {
      const cleanHandle = handle.replace('@', '').trim();
      const response = await fetch(`/api/games/${gameId}/verify-twitter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ twitterHandle: cleanHandle }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to verify Twitter handle");
      }

      return response.json() as Promise<VerificationResponse>;
    },
    onSuccess: (data) => {
      setVerificationToken(data.token);
      setBlinkUrl(data.blinkUrl);
      toast({
        title: "Twitter Handle Verified!",
        description: `@${data.twitterHandle} is ready to join the battle!`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!twitterHandle.trim()) {
      toast({
        title: "Twitter Handle Required",
        description: "Please enter your Twitter handle",
        variant: "destructive",
      });
      return;
    }
    verifyHandleMutation.mutate(twitterHandle);
  };

  if (gameLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-muted-foreground">Loading game...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameError || !game) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-6 w-6 text-destructive" />
              <CardTitle>Game Not Found</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              This game doesn't exist or has been removed.
            </p>
            <Button onClick={() => navigate("/")} data-testid="button-go-home">
              Go Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (game.status !== "pending") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-6 w-6 text-amber-500" />
              <CardTitle>Game Unavailable</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              This game has already {game.status === "active" ? "started" : "ended"}.
            </p>
            <Button onClick={() => navigate("/")} data-testid="button-go-home">
              Go Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (game.currentPlayers >= game.maxPlayers) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-6 w-6 text-amber-500" />
              <CardTitle>Game Full</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              This game is full with {game.maxPlayers} players.
            </p>
            <Button onClick={() => navigate("/")} data-testid="button-go-home">
              Go Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="text-3xl">🚢</span>
            <CardTitle className="text-2xl font-mono">
              BATTLE DINGHY GAME #{game.gameNumber}
            </CardTitle>
            <span className="text-3xl">⚓</span>
          </div>
          <CardDescription className="text-lg">
            Join the naval battle on Twitter!
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Entry Fee</div>
              <div className="text-lg font-bold">
                {(game.entryFeeSol / 1_000_000_000).toFixed(3)} SOL
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Prize Pool</div>
              <div className="text-lg font-bold text-primary">
                {(game.prizePoolSol / 1_000_000_000).toFixed(2)} SOL
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Players</div>
              <div className="text-lg font-bold">
                {game.currentPlayers}/{game.maxPlayers}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Status</div>
              <Badge variant="outline" className="font-mono">
                OPEN
              </Badge>
            </div>
          </div>

          {!verificationToken ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="twitter-handle">Twitter Handle</Label>
                <div className="flex gap-2">
                  <span className="flex items-center justify-center w-10 h-10 bg-muted rounded-md text-muted-foreground">
                    @
                  </span>
                  <Input
                    id="twitter-handle"
                    data-testid="input-twitter-handle"
                    type="text"
                    placeholder="username"
                    value={twitterHandle}
                    onChange={(e) => {
                      let value = e.target.value;
                      // Remove @ since we display it separately
                      value = value.replace('@', '');
                      setTwitterHandle(value);
                    }}
                    disabled={verifyHandleMutation.isPending}
                    className="flex-1"
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Enter your Twitter handle so we can @mention you with your board card
                </p>
              </div>

              <Button
                type="submit"
                data-testid="button-verify-handle"
                className="w-full"
                disabled={verifyHandleMutation.isPending || !twitterHandle.trim()}
              >
                {verifyHandleMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify & Continue"
                )}
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                <AlertDescription className="text-green-800 dark:text-green-200">
                  Twitter handle <span className="font-mono font-bold">@{twitterHandle.replace('@', '')}</span> verified!
                  Click below to pay and join the battle.
                </AlertDescription>
              </Alert>

              {blinkUrl && (
                <div className="space-y-2">
                  <Label>Payment Blink</Label>
                  <div className="p-4 bg-muted rounded-lg border-2 border-dashed">
                    <p className="text-sm text-muted-foreground mb-3 text-center">
                      Connect your wallet and pay {(game.entryFeeSol / 1_000_000_000).toFixed(3)} SOL to join
                    </p>
                    <div className="flex justify-center">
                      <a
                        href={blinkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="link-payment-blink"
                      >
                        <Button size="lg" className="font-mono" data-testid="button-open-blink">
                          Open Blink to Pay
                        </Button>
                      </a>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Opens in your Solana wallet app
                  </p>
                </div>
              )}

              <div className="pt-4 border-t space-y-2">
                <h4 className="font-semibold text-sm">What happens next?</h4>
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Pay via Blink → Transaction confirms</li>
                  <li>@battle_dinghy will @mention you with your board card</li>
                  <li>Game starts when full or scheduled time</li>
                  <li>Watch the thread for shot announcements!</li>
                </ol>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
