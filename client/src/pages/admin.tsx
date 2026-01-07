import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, XCircle, AlertCircle, Send, Eye } from "lucide-react";
import { useState, useMemo } from "react";

type StatusResponse = {
  twitter: {
    configured: boolean;
    hasApiKey: boolean;
    hasApiSecret: boolean;
    hasAccessToken: boolean;
    hasAccessSecret: boolean;
  };
  oreMonitor: {
    isMonitoring: boolean;
    gameId: string | null;
    subscriptionId: number | null;
  };
  solana: {
    escrowAddress: string | null;
    escrowBalance: number;
  };
};

export default function AdminPage() {
  const { toast } = useToast();

  // Game configuration state
  const [entryFeeSol, setEntryFeeSol] = useState<string>("0.01"); // SOL (user-friendly)
  const [maxPlayers, setMaxPlayers] = useState<string>("35");
  const [customMessage, setCustomMessage] = useState<string>("");

  // Base URL for Blink preview
  const baseUrl = window.location.origin;

  const { data: status, isLoading: statusLoading } = useQuery<StatusResponse>({
    queryKey: ["/api/status"],
    refetchInterval: 5000,
    queryFn: async () => {
      const response = await fetch("/api/status");
      if (!response.ok) throw new Error("Failed to fetch status");
      return response.json();
    },
  });

  // Generate tweet preview text
  // Use max-length placeholder (BD-XXXXXXXXX = 13 chars) for accurate character count
  const tweetPreview = useMemo(() => {
    const fee = parseFloat(entryFeeSol) || 0.01;
    const players = parseInt(maxPlayers) || 35;
    const blinkUrl = `${baseUrl}/blinks/join/BD-XXXXXXXXX`;

    let text = "";
    if (customMessage.trim()) {
      text += `${customMessage.trim()}\n\n`;
    }
    text += `⚓ BATTLE DINGHY ⚓\n\n`;
    text += `💰 Buy-in: ${fee} SOL\n`;
    text += `👥 Max Players: ${players}\n`;
    text += `🏆 Winner takes all!\n\n`;
    text += `Join the battle 👇\n\n`;
    text += blinkUrl;

    return text;
  }, [entryFeeSol, maxPlayers, customMessage, baseUrl]);

  const characterCount = tweetPreview.length;
  const isOverLimit = characterCount > 280;

  // Create and post game mutation
  const createAndPostMutation = useMutation({
    mutationFn: async () => {
      const entryFee = parseFloat(entryFeeSol);
      const maxPlayersNum = parseInt(maxPlayers);

      if (isNaN(entryFee) || entryFee <= 0) {
        throw new Error("Entry fee must be a positive number");
      }

      if (isNaN(maxPlayersNum) || maxPlayersNum < 2 || maxPlayersNum > 100) {
        throw new Error("Max players must be between 2 and 100");
      }

      if (isOverLimit) {
        throw new Error("Tweet exceeds 280 character limit");
      }

      const response = await fetch("/api/admin/games/create-and-post", {
        method: "POST",
        body: JSON.stringify({
          entryFeeSol: entryFee,
          maxPlayers: maxPlayersNum,
          customMessage: customMessage.trim() || undefined,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create and post game");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.tweetUrl) {
        toast({
          title: "Game Posted! 🎉",
          description: (
            <div>
              <p>Game <strong>{data.gameId}</strong> created and posted to Twitter!</p>
              <a
                href={data.tweetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline mt-2 block"
              >
                View Tweet →
              </a>
            </div>
          ),
        });
      } else {
        toast({
          title: "Game Created",
          description: data.error || `Game ${data.gameId} created but tweet may have failed.`,
          variant: data.error ? "destructive" : "default",
        });
      }
      // Reset form
      setCustomMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/status"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Create Game",
        description: error.message || "Unknown error occurred",
        variant: "destructive",
      });
    },
  });

  const testTwitterMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/admin/test-twitter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || "Failed to test Twitter");
      }
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Twitter Test Successful",
        description: `Test tweet posted! ID: ${data.tweetId}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Twitter Test Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const StatusBadge = ({ value }: { value: boolean }) => (
    <Badge variant={value ? "default" : "destructive"} className="ml-2">
      {value ? (
        <>
          <CheckCircle className="w-3 h-3 mr-1" />
          Ready
        </>
      ) : (
        <>
          <XCircle className="w-3 h-3 mr-1" />
          Missing
        </>
      )}
    </Badge>
  );

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen" data-testid="status-loading">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="text-page-title">
            Battle Dinghy Admin
          </h1>
          <p className="text-muted-foreground">Game management and system status</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>System Status</CardTitle>
            <CardDescription>Check configuration and monitor services</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2 flex items-center">
                Twitter Bot
                {status?.twitter.configured ? (
                  <StatusBadge value={true} />
                ) : (
                  <Badge variant="destructive" className="ml-2">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    Not Configured
                  </Badge>
                )}
              </h3>
              <div className="ml-4 space-y-1 text-sm text-muted-foreground">
                <div data-testid="status-twitter-apikey">
                  API Key: <StatusBadge value={status?.twitter.hasApiKey ?? false} />
                </div>
                <div data-testid="status-twitter-apisecret">
                  API Secret: <StatusBadge value={status?.twitter.hasApiSecret ?? false} />
                </div>
                <div data-testid="status-twitter-token">
                  Access Token: <StatusBadge value={status?.twitter.hasAccessToken ?? false} />
                </div>
                <div data-testid="status-twitter-secret">
                  Access Secret: <StatusBadge value={status?.twitter.hasAccessSecret ?? false} />
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2 flex items-center">
                ORE Monitor
                {status?.oreMonitor.isMonitoring ? (
                  <Badge variant="default" className="ml-2">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Active
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="ml-2">Idle</Badge>
                )}
              </h3>
              <div className="ml-4 space-y-1 text-sm text-muted-foreground">
                <div data-testid="status-ore-gameid">
                  Game ID: {status?.oreMonitor.gameId || "None"}
                </div>
                <div data-testid="status-ore-subscription">
                  Subscription ID: {status?.oreMonitor.subscriptionId ?? "None"}
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2 flex items-center">
                Solana Escrow
                {status?.solana.escrowAddress ? (
                  <StatusBadge value={true} />
                ) : (
                  <Badge variant="destructive" className="ml-2">
                    <XCircle className="w-3 h-3 mr-1" />
                    Not Configured
                  </Badge>
                )}
              </h3>
              <div className="ml-4 space-y-1 text-sm text-muted-foreground">
                <div className="break-all" data-testid="status-solana-address">
                  Address: {status?.solana.escrowAddress || "Not configured"}
                </div>
                <div data-testid="status-solana-balance">
                  Balance: {status?.solana.escrowBalance?.toFixed(4)} SOL
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Twitter OAuth Authorization</CardTitle>
            <CardDescription>Authorize @battle_dinghy to post from your app</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Your API keys are from @thejustinfagan's app. To post from @battle_dinghy, 
                you need to authorize that account via OAuth.
              </p>
              <Button
                onClick={() => window.open('/api/admin/oauth/start', '_blank')}
                disabled={!status?.twitter.hasApiKey || !status?.twitter.hasApiSecret}
                data-testid="button-authorize-twitter"
              >
                Authorize @battle_dinghy
              </Button>
              {(!status?.twitter.hasApiKey || !status?.twitter.hasApiSecret) && (
                <p className="text-sm text-destructive mt-2">
                  API Key and Secret required to start OAuth flow
                </p>
              )}
              <div className="text-xs text-muted-foreground space-y-1 mt-3">
                <p><strong>Steps:</strong></p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Click "Authorize @battle_dinghy"</li>
                  <li>Log in as @battle_dinghy on Twitter</li>
                  <li>Click "Authorize app"</li>
                  <li>Copy the Access Token and Access Secret</li>
                  <li>Add them to your Replit Secrets</li>
                  <li>Restart the application</li>
                </ol>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Twitter Bot Testing</CardTitle>
            <CardDescription>Test Twitter API credentials and posting</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => testTwitterMutation.mutate()}
              disabled={testTwitterMutation.isPending || !status?.twitter.configured}
              variant="outline"
              data-testid="button-test-twitter"
            >
              {testTwitterMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test Twitter Connection"
              )}
            </Button>
            {!status?.twitter.configured && (
              <p className="text-sm text-destructive mt-2">
                Configure Twitter credentials to test
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              This will post a test tweet to @battle_dinghy to verify credentials work correctly.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5" />
              Create & Post Game
            </CardTitle>
            <CardDescription>
              Configure game settings, preview the tweet, and post to @battle_dinghy
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              {/* Left Column: Form */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="entry-fee" data-testid="label-entry-fee">
                    Buy-in (SOL)
                  </Label>
                  <Input
                    id="entry-fee"
                    type="number"
                    step="0.001"
                    min="0.001"
                    max="100"
                    placeholder="0.01"
                    value={entryFeeSol}
                    onChange={(e) => setEntryFeeSol(e.target.value)}
                    data-testid="input-entry-fee"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max-players" data-testid="label-max-players">
                    Max Players
                  </Label>
                  <Input
                    id="max-players"
                    type="number"
                    min="2"
                    max="100"
                    placeholder="35"
                    value={maxPlayers}
                    onChange={(e) => setMaxPlayers(e.target.value)}
                    data-testid="input-max-players"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="custom-message">
                    Custom Message <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Textarea
                    id="custom-message"
                    placeholder="Add your announcement message here..."
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    rows={3}
                    data-testid="input-custom-message"
                  />
                  <p className="text-xs text-muted-foreground">
                    This appears before the game details in the tweet
                  </p>
                </div>
              </div>

              {/* Right Column: Preview */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Eye className="w-4 h-4" />
                  Tweet Preview
                </div>
                <div className="bg-muted/50 border rounded-lg p-4 min-h-[200px]">
                  <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">
                    {tweetPreview}
                  </pre>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className={`${isOverLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                    {characterCount}/280 characters
                  </span>
                  {isOverLimit && (
                    <span className="text-destructive text-xs">
                      Tweet is too long!
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Action Button */}
            <div className="mt-6 pt-4 border-t flex items-center justify-between">
              <div>
                {!status?.twitter.configured && (
                  <p className="text-sm text-destructive">
                    Twitter credentials required
                  </p>
                )}
              </div>
              <Button
                onClick={() => createAndPostMutation.mutate()}
                disabled={createAndPostMutation.isPending || !status?.twitter.configured || isOverLimit}
                size="lg"
                data-testid="button-create-and-post"
              >
                {createAndPostMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating & Posting...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Create & Post to Twitter
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Setup Instructions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <h4 className="font-semibold mb-2">1. Twitter API Credentials</h4>
              <p className="text-muted-foreground mb-2">
                Add these environment variables to enable the Twitter bot:
              </p>
              <code className="block bg-muted p-3 rounded text-xs">
                TWITTER_API_KEY=your_api_key<br />
                TWITTER_API_SECRET=your_api_secret<br />
                TWITTER_ACCESS_TOKEN=your_access_token<br />
                TWITTER_ACCESS_SECRET=your_access_secret
              </code>
            </div>

            <div>
              <h4 className="font-semibold mb-2">2. Solana Configuration</h4>
              <p className="text-muted-foreground mb-2">
                Configure Solana RPC and escrow wallet:
              </p>
              <code className="block bg-muted p-3 rounded text-xs">
                SOLANA_RPC_URL=https://api.mainnet-beta.solana.com<br />
                ORE_PROGRAM_ID=&lt;actual_ore_program_id&gt;<br />
                ESCROW_WALLET_SECRET=&lt;json_array_of_keypair&gt;
              </code>
            </div>

            <div>
              <h4 className="font-semibold mb-2">3. Admin Authentication</h4>
              <p className="text-muted-foreground mb-2">
                For production, set a secure admin API key:
              </p>
              <code className="block bg-muted p-3 rounded text-xs">
                ADMIN_API_KEY=your_secure_admin_key
              </code>
              <p className="text-xs text-muted-foreground mt-2">
                Development: localhost requests are auto-authorized
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-2">4. Database</h4>
              <p className="text-muted-foreground">
                PostgreSQL database is already configured via DATABASE_URL
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
