import { Construction } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Página placeholder para secções do Admin ainda não implementadas.
 */
export default function PlaceholderPage({
  titulo,
  descricao,
}: {
  titulo: string;
  descricao: string;
}) {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="hidden flex-col gap-1 lg:flex">
        <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
        <p className="text-sm text-muted-foreground">{descricao}</p>
      </div>

      <Card className="lg:hidden">
        <CardHeader>
          <CardTitle>{titulo}</CardTitle>
          <CardDescription>{descricao}</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Construction className="h-7 w-7" />
          </div>
          <div>
            <p className="font-medium">Em breve</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Esta secção fará parte da próxima fase de desenvolvimento.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
