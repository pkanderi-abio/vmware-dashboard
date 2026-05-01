import { Link } from 'react-router-dom';
import { Home, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <AlertCircle className="w-16 h-16 text-muted-foreground mb-4" />
      <h1 className="text-4xl font-bold text-foreground mb-2">404</h1>
      <p className="text-lg text-muted-foreground mb-6">Page not found</p>
      <Link to="/">
        <Button>
          <Home className="w-4 h-4 mr-2" />
          Go to Dashboard
        </Button>
      </Link>
    </div>
  );
}